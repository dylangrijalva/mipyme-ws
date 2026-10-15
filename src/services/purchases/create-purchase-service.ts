import { ExponentialBackoff, handleWhenResult, retry } from "cockatiel";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import { PositiveDecimal } from "../../contracts/decimal.ts";
import { ObjectId } from "../../contracts/object-id.ts";
import type { Purchase } from "../../contracts/purchase.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { PurchaseFinder } from "../../finders/purchase-finder.ts";
import type { RealtimeEventPublisher } from "../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../utils/assert-found.ts";
import { add, divideAndRound, multiply } from "../../utils/decimal.ts";
import { generateId } from "../../utils/generate-id.ts";
import { now } from "../../utils/now.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

const shouldRetryCreatePurchaseResult = (result: unknown): boolean => {
  if (typeof result !== "object" || result === null) {
    return false;
  }

  if (!("success" in result) || result.success !== false || !("error" in result)) {
    return false;
  }

  const { error } = result;
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === codes.concurrentUpdateConflict
  );
};

const CREATE_PURCHASE_RETRY_POLICY = retry(handleWhenResult(shouldRetryCreatePurchaseResult), {
  maxAttempts: 2,
  backoff: new ExponentialBackoff({ initialDelay: 25, maxDelay: 100 }),
});

const CreatePurchaseRequest = z.object({
  supplierId: ObjectId,
  locationId: ObjectId,
  notes: z.string().trim().max(256).nullish(),
  lineItems: z
    .array(
      z.object({
        variantId: ObjectId,
        quantity: z.number().int().positive().max(2_147_483_647),
        unitCost: PositiveDecimal,
      }),
    )
    .min(1, { message: "At least one line item is required." }),
});

type CreatePurchaseRequest = z.infer<typeof CreatePurchaseRequest>;

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  publisher: RealtimeEventPublisher;
  purchaseFinder: PurchaseFinder;
  user: CurrentUser;
};

type ProductPurchase = {
  productId: string;
  unitCost: string;
  updatedAt: Date;
  receivedQuantity: string;
  receivedValue: string;
};

class CreatePurchaseService extends BaseService<CreatePurchaseRequest, Purchase> {
  private readonly db: Database;
  private readonly publisher: RealtimeEventPublisher;
  private readonly purchaseFinder: PurchaseFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    purchaseFinder: PurchaseFinder,
    publisher: RealtimeEventPublisher,
    user: CurrentUser,
  ) {
    super(logger);
    this.db = db;
    this.publisher = publisher;
    this.purchaseFinder = purchaseFinder;
    this.user = user;
  }

  static create(deps: InjectedDependencies): CreatePurchaseService {
    return new CreatePurchaseService(deps.logger, deps.db, deps.purchaseFinder, deps.publisher, deps.user);
  }

  async execute(request: CreatePurchaseRequest): Promise<Result<Purchase, BusinessError>> {
    const variantIds = new Set<string>();

    const hasDuplicateVariant = request.lineItems.some(({ variantId }) => {
      if (variantIds.has(variantId)) {
        return true;
      }

      variantIds.add(variantId);
      return false;
    });

    if (hasDuplicateVariant) {
      return err({
        code: codes.validationError,
        message: "Each variant can only appear once in a purchase.",
        details: [],
      });
    }

    const runTransaction = () =>
      this.db.transaction(async (trx) => {
        const [location] = await trx
          .select()
          .from(tables.location)
          .where(and(eq(tables.location.merchantId, this.user.merchantId), eq(tables.location.id, request.locationId)))
          .limit(1);

        if (!location) {
          return err({
            code: codes.resourceNotFound,
            message: `Location ${request.locationId} has not been found.`,
            details: [],
          });
        }

        const [supplier] = await trx
          .select({ id: tables.supplier.id })
          .from(tables.supplier)
          .where(and(eq(tables.supplier.merchantId, this.user.merchantId), eq(tables.supplier.id, request.supplierId)))
          .limit(1);

        if (!supplier) {
          return err({
            code: codes.resourceNotFound,
            message: `Supplier ${request.supplierId} has not been found.`,
            details: [],
          });
        }

        const variantRecords = await trx
          .select({
            id: tables.variant.id,
            name: tables.variant.name,
            price: tables.variant.price,
            productId: tables.product.id,
            productType: tables.product.type,
            unitCost: tables.product.unitCost,
            updatedAt: tables.product.updatedAt,
          })
          .from(tables.variant)
          .innerJoin(tables.product, eq(tables.product.id, tables.variant.productId))
          .where(
            and(
              eq(tables.variant.merchantId, this.user.merchantId),
              inArray(
                tables.variant.id,
                request.lineItems.map(({ variantId }) => variantId),
              ),
              isNull(tables.variant.archivedAt),
              isNull(tables.product.archivedAt),
            ),
          );

        if (variantRecords.length !== request.lineItems.length) {
          return err({
            code: codes.resourceNotFound,
            message: "One or more variants have not been found.",
            details: [],
          });
        }

        if (variantRecords.some(({ productType }) => productType === "service")) {
          return err({
            code: codes.validationError,
            message: "Purchases can only contain item products.",
            details: [],
          });
        }

        const variantsById = new Map(variantRecords.map((variant) => [variant.id, variant]));
        const purchaseLines = request.lineItems.map((lineItem) => ({
          ...lineItem,
          variant: variantsById.get(lineItem.variantId)!,
        }));
        const productPurchases = new Map<string, ProductPurchase>();

        for (const purchaseLine of purchaseLines) {
          const productId = purchaseLine.variant.productId;
          const productPurchase = productPurchases.get(productId) ?? {
            productId,
            unitCost: purchaseLine.variant.unitCost,
            updatedAt: purchaseLine.variant.updatedAt,
            receivedQuantity: "0",
            receivedValue: "0",
          };

          productPurchase.receivedQuantity = add(productPurchase.receivedQuantity, String(purchaseLine.quantity));
          productPurchase.receivedValue = add(
            productPurchase.receivedValue,
            multiply(String(purchaseLine.quantity), purchaseLine.unitCost),
          );
          productPurchases.set(productId, productPurchase);
        }

        const productIds = [...productPurchases.keys()].sort();
        const pooledInventory = await trx
          .select({
            productId: tables.variant.productId,
            onHand: sql<string>`CAST(COALESCE(SUM(${tables.inventoryLevel.onHand}), 0) AS CHAR)`,
          })
          .from(tables.variant)
          .leftJoin(
            tables.inventoryLevel,
            and(
              eq(tables.inventoryLevel.merchantId, this.user.merchantId),
              eq(tables.inventoryLevel.variantId, tables.variant.id),
            ),
          )
          .where(
            and(eq(tables.variant.merchantId, this.user.merchantId), inArray(tables.variant.productId, productIds)),
          )
          .groupBy(tables.variant.productId);
        const pooledInventoryByProduct = new Map(pooledInventory.map(({ productId, onHand }) => [productId, onHand]));

        const locationInventory = await trx
          .select()
          .from(tables.inventoryLevel)
          .where(
            and(
              eq(tables.inventoryLevel.merchantId, this.user.merchantId),
              eq(tables.inventoryLevel.locationId, request.locationId),
              inArray(
                tables.inventoryLevel.variantId,
                request.lineItems.map(({ variantId }) => variantId),
              ),
            ),
          );
        const locationInventoryByVariant = new Map(locationInventory.map((level) => [level.variantId, level]));

        const nextUnitCosts = new Map(
          [...productPurchases.values()].map((productPurchase) => {
            const existingQuantity = pooledInventoryByProduct.get(productPurchase.productId) ?? "0";
            const existingValue = multiply(existingQuantity, productPurchase.unitCost);
            const totalValue = add(existingValue, productPurchase.receivedValue);
            const totalQuantity = add(existingQuantity, productPurchase.receivedQuantity);
            const nextUnitCost = divideAndRound(totalValue, totalQuantity, 2);

            return [productPurchase.productId, nextUnitCost];
          }),
        );

        const lockedProducts = await trx
          .select({ id: tables.product.id, updatedAt: tables.product.updatedAt })
          .from(tables.product)
          .where(and(eq(tables.product.merchantId, this.user.merchantId), inArray(tables.product.id, productIds)))
          .orderBy(asc(tables.product.id))
          .for("update");

        const productInventoryChanged =
          lockedProducts.length !== productIds.length ||
          lockedProducts.some(
            ({ id, updatedAt }) => productPurchases.get(id)?.updatedAt.getTime() !== updatedAt.getTime(),
          );

        if (productInventoryChanged) {
          return err({
            code: codes.concurrentUpdateConflict,
            message: "Inventory changed while the purchase was being created. Retry the request.",
            details: [],
          });
        }

        const [lockedLocation] = await trx
          .select({ id: tables.location.id, nextPurchaseOrderNumber: tables.location.nextPurchaseOrderNumber })
          .from(tables.location)
          .where(and(eq(tables.location.merchantId, this.user.merchantId), eq(tables.location.id, location.id)))
          .for("update")
          .limit(1);

        if (!lockedLocation || lockedLocation.nextPurchaseOrderNumber !== location.nextPurchaseOrderNumber) {
          return err({
            code: codes.concurrentUpdateConflict,
            message: "The location purchase number changed while the purchase was being created. Retry the request.",
            details: [],
          });
        }

        const createdAt = now();
        for (const productId of productIds) {
          const productPurchase = productPurchases.get(productId)!;
          await trx
            .update(tables.product)
            .set({
              unitCost: nextUnitCosts.get(productPurchase.productId)!,
              lastRestockAt: createdAt,
              lastInventoryChangedAt: createdAt,
              updatedAt: new Date(Math.max(createdAt.getTime(), productPurchase.updatedAt.getTime() + 1)),
            })
            .where(
              and(
                eq(tables.product.merchantId, this.user.merchantId),
                eq(tables.product.id, productPurchase.productId),
                eq(tables.product.updatedAt, productPurchase.updatedAt),
              ),
            );
        }

        const transactionNumber = location.nextPurchaseOrderNumber;

        await trx
          .update(tables.location)
          .set({ nextPurchaseOrderNumber: transactionNumber + 1, updatedAt: now() })
          .where(
            and(
              eq(tables.location.merchantId, this.user.merchantId),
              eq(tables.location.id, location.id),
              eq(tables.location.nextPurchaseOrderNumber, transactionNumber),
            ),
          );

        const purchaseId = generateId({ model: "purchaseOrder" });
        const purchaseItemValues = purchaseLines.map((purchaseLine) => ({
          id: generateId({ model: "purchaseOrderItem" }),
          name: purchaseLine.variant.name,
          quantity: purchaseLine.quantity,
          price: purchaseLine.variant.price,
          unitCost: purchaseLine.unitCost,
          previousUnitCost: purchaseLine.variant.unitCost,
          purchaseOrderId: purchaseId,
          variantId: purchaseLine.variant.id,
          merchantId: this.user.merchantId,
        }));

        await trx
          .insert(tables.supplierProduct)
          .values(
            productIds.map((productId) => ({
              id: generateId({ model: "supplierProduct" }),
              supplierId: request.supplierId,
              productId,
              merchantId: this.user.merchantId,
            })),
          )
          .onDuplicateKeyUpdate({ set: { id: sql`${tables.supplierProduct.id}` } });

        await trx.insert(tables.purchaseOrder).values({
          id: purchaseId,
          status: "fulfilled",
          transactionNumber,
          notes: request.notes ?? null,
          supplierId: request.supplierId,
          merchantId: this.user.merchantId,
          locationId: request.locationId,
          createdById: this.user.employeeId,
          createdAt,
          updatedAt: createdAt,
        });

        await trx.insert(tables.purchaseOrderItem).values(purchaseItemValues);

        for (const purchaseLine of purchaseLines) {
          const previousLevel = locationInventoryByVariant.get(purchaseLine.variantId);
          const inventoryLevelId = previousLevel?.id ?? generateId({ model: "inventoryLevel" });

          if (previousLevel) {
            await trx
              .update(tables.inventoryLevel)
              .set({ onHand: previousLevel.onHand + purchaseLine.quantity, updatedAt: createdAt })
              .where(
                and(
                  eq(tables.inventoryLevel.merchantId, this.user.merchantId),
                  eq(tables.inventoryLevel.id, previousLevel.id),
                ),
              );
          } else {
            await trx.insert(tables.inventoryLevel).values({
              id: inventoryLevelId,
              onHand: purchaseLine.quantity,
              locationId: request.locationId,
              variantId: purchaseLine.variantId,
              merchantId: this.user.merchantId,
            });
          }

          await trx.insert(tables.inventoryMovement).values({
            id: generateId({ model: "inventoryMovement" }),
            reason: "purchase",
            fromState: previousLevel?.onHand ? "in_stock" : "none",
            toState: "in_stock",
            quantityDelta: purchaseLine.quantity,
            unitCost: purchaseLine.unitCost,
            referenceId: purchaseId,
            createdById: this.user.employeeId,
            inventoryLevelId,
            merchantId: this.user.merchantId,
            occurredAt: createdAt,
          });
        }

        const purchase = await assertFound(
          this.purchaseFinder.find(trx, { id: purchaseId, merchantId: this.user.merchantId }),
        );

        return ok(purchase);
      });

    const result = await CREATE_PURCHASE_RETRY_POLICY.execute(runTransaction);
    if (result.success) {
      this.publisher.broadcast({
        merchantId: this.user.merchantId,
        resource: { type: "purchase_order", snapshot: result.value },
      });
    }

    return result;
  }
}

export { CreatePurchaseRequest, CreatePurchaseService };
