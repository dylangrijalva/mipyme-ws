import { ExponentialBackoff, fallback, handleWhen, retry } from "cockatiel";
import { and, asc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Purchase } from "../../contracts/purchase.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { PurchaseFinder } from "../../finders/purchase-finder.ts";
import type { RealtimeEventPublisher } from "../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../utils/assert-found.ts";
import { ConcurrentUpdateError, isConcurrentUpdateError } from "../../utils/concurrent-update-error.ts";
import { generateId } from "../../utils/generate-id.ts";
import { now } from "../../utils/now.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";
import { EmployeeAuthorizationService } from "../employee-authorization-service.ts";

const VoidPurchaseRequest = z.object({
  reason: z
    .string()
    .trim()
    .max(256)
    .nullish()
    .transform((reason) => reason || null)
    .optional(),
});

type VoidPurchaseRequest = z.infer<typeof VoidPurchaseRequest>;

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  publisher: RealtimeEventPublisher;
  purchaseFinder: PurchaseFinder;
  user: CurrentUser;
};

const VOID_PURCHASE_RETRY_POLICY = retry(handleWhen(isConcurrentUpdateError), {
  maxAttempts: 2,
  backoff: new ExponentialBackoff({ initialDelay: 25, maxDelay: 100 }),
});

const VOID_PURCHASE_FALLBACK_POLICY = fallback(handleWhen(isConcurrentUpdateError), () =>
  err({
    code: codes.concurrentUpdateConflict,
    message: "Inventory changed while the purchase was being voided. Retry the request.",
    details: [],
  }),
);

class VoidPurchaseService extends BaseService<string, Purchase> {
  private readonly db: Database;
  private readonly publisher: RealtimeEventPublisher;
  private readonly purchaseFinder: PurchaseFinder;
  private readonly user: CurrentUser;

  constructor({ logger, db, publisher, purchaseFinder, user }: InjectedDependencies) {
    super(logger);
    this.db = db;
    this.publisher = publisher;
    this.purchaseFinder = purchaseFinder;
    this.user = user;
  }

  static create(dependencies: InjectedDependencies): VoidPurchaseService {
    return new VoidPurchaseService(dependencies);
  }

  async execute(id: string, request: VoidPurchaseRequest = {}): Promise<Result<Purchase, BusinessError>> {
    const voidPurchaseWithRetry = () =>
      VOID_PURCHASE_RETRY_POLICY.execute(() => this.voidPurchase(id, request.reason ?? null));

    const result = await VOID_PURCHASE_FALLBACK_POLICY.execute(voidPurchaseWithRetry);
    if (result.success) {
      this.publisher.broadcast({
        merchantId: this.user.merchantId,
        resource: { type: "purchase_order", snapshot: result.value },
      });
    }

    return result;
  }

  private async voidPurchase(id: string, reason: string | null): Promise<Result<Purchase, BusinessError>> {
    const employeeAuthorization = EmployeeAuthorizationService.create({ db: this.db });

    const authorization = await employeeAuthorization.authorizePermission({
      employeeId: this.user.employeeId,
      merchantId: this.user.merchantId,
      permission: "void_transaction",
    });

    if (!authorization.success && authorization.error.kind === "employee_unavailable") {
      return err({ code: codes.forbiddenError, message: "You do not have permission to void purchases.", details: [] });
    }

    const [purchase] = await this.db
      .select()
      .from(tables.purchaseOrder)
      .where(and(eq(tables.purchaseOrder.id, id), eq(tables.purchaseOrder.merchantId, this.user.merchantId)))
      .limit(1);
    if (!purchase) {
      return err({ code: codes.resourceNotFound, message: "The purchase has not been found.", details: [] });
    }

    if (!authorization.success) {
      return err({ code: codes.forbiddenError, message: "You do not have permission to void purchases.", details: [] });
    }

    const employee = authorization.value;
    const locationAuthorization = await employeeAuthorization.authorizeLocationAccess({
      employee,
      locationId: purchase.locationId,
    });

    if (!locationAuthorization.success) {
      if (locationAuthorization.error.kind === "location_not_found") {
        return err({ code: codes.resourceNotFound, message: "The location has not been found.", details: [] });
      }

      return err({ code: codes.forbiddenError, message: "You do not have access to this location.", details: [] });
    }

    if (purchase.status === "voided") {
      return ok(await assertFound(this.purchaseFinder.find(this.db, { id, merchantId: this.user.merchantId })));
    }

    if (purchase.status !== "fulfilled") {
      return err({ code: codes.validationError, message: "Only fulfilled purchases can be voided.", details: [] });
    }

    const items = await this.db
      .select()
      .from(tables.purchaseOrderItem)
      .where(
        and(
          eq(tables.purchaseOrderItem.purchaseOrderId, id),
          eq(tables.purchaseOrderItem.merchantId, this.user.merchantId),
        ),
      );

    if (!items.length || items.some((item) => item.previousUnitCost === null)) {
      return err({
        code: codes.validationError,
        message: "This purchase cannot be voided because its previous product costs are unavailable.",
        details: [],
      });
    }

    const variants = await this.db
      .select()
      .from(tables.variant)
      .where(
        and(
          eq(tables.variant.merchantId, this.user.merchantId),
          inArray(
            tables.variant.id,
            items.map((item) => item.variantId),
          ),
        ),
      );

    if (variants.length !== items.length) {
      throw new ConcurrentUpdateError();
    }

    const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
    const productSnapshots = new Map(items.map((item) => [variantsById.get(item.variantId)!.productId, item]));
    const products = await this.db
      .select()
      .from(tables.product)
      .where(
        and(
          eq(tables.product.merchantId, this.user.merchantId),
          inArray(tables.product.id, [...productSnapshots.keys()]),
        ),
      )
      .orderBy(asc(tables.product.id));
    if (products.length !== productSnapshots.size) {
      throw new ConcurrentUpdateError();
    }

    const [laterMovement] = await this.db
      .select({ id: tables.inventoryMovement.id })
      .from(tables.inventoryMovement)
      .innerJoin(
        tables.inventoryLevel,
        and(
          eq(tables.inventoryLevel.id, tables.inventoryMovement.inventoryLevelId),
          eq(tables.inventoryLevel.merchantId, this.user.merchantId),
        ),
      )
      .innerJoin(
        tables.variant,
        and(
          eq(tables.variant.id, tables.inventoryLevel.variantId),
          eq(tables.variant.merchantId, this.user.merchantId),
        ),
      )
      .where(
        and(
          eq(tables.inventoryMovement.merchantId, this.user.merchantId),
          inArray(tables.variant.productId, [...productSnapshots.keys()]),
          gte(tables.inventoryMovement.occurredAt, purchase.createdAt),
          or(
            ne(tables.inventoryMovement.reason, "purchase"),
            isNull(tables.inventoryMovement.referenceId),
            ne(tables.inventoryMovement.referenceId, purchase.id),
          ),
        ),
      )
      .limit(1);
    const inventoryChanged =
      Boolean(laterMovement) ||
      products.some((product) => product.lastInventoryChangedAt?.getTime() !== purchase.createdAt.getTime());

    if (inventoryChanged) {
      const [currentPurchase] = await this.db
        .select({ status: tables.purchaseOrder.status })
        .from(tables.purchaseOrder)
        .where(and(eq(tables.purchaseOrder.id, id), eq(tables.purchaseOrder.merchantId, this.user.merchantId)));
      if (currentPurchase?.status === "voided") {
        return ok(await assertFound(this.purchaseFinder.find(this.db, { id, merchantId: this.user.merchantId })));
      }

      return err({
        code: codes.validationError,
        message: "This purchase cannot be voided because a product's inventory changed after the purchase.",
        details: [],
      });
    }

    const inventoryLevels = await this.db
      .select()
      .from(tables.inventoryLevel)
      .where(
        and(
          eq(tables.inventoryLevel.merchantId, this.user.merchantId),
          eq(tables.inventoryLevel.locationId, purchase.locationId),
          inArray(
            tables.inventoryLevel.variantId,
            items.map((item) => item.variantId),
          ),
        ),
      )
      .orderBy(asc(tables.inventoryLevel.variantId));

    const inventoryLevelsByVariantId = new Map(inventoryLevels.map((level) => [level.variantId, level]));
    if (inventoryLevels.length !== items.length) {
      throw new ConcurrentUpdateError();
    }

    if (items.some((item) => inventoryLevelsByVariantId.get(item.variantId)!.onHand < item.quantity)) {
      return err({
        code: codes.stockInsufficient,
        message: "There is not enough stock at the purchase location to void this purchase.",
        details: [],
      });
    }

    return this.db.transaction(
      async (trx): Promise<Result<Purchase, BusinessError>> => {
        const voidedAt = now();
        for (const product of products) {
          const snapshot = productSnapshots.get(product.id)!;
          const [updatedProduct] = await trx
            .update(tables.product)
            .set({
              unitCost: snapshot.previousUnitCost!,
              lastInventoryChangedAt: voidedAt,
              updatedAt: new Date(Math.max(voidedAt.getTime(), product.updatedAt.getTime() + 1)),
            })
            .where(
              and(
                eq(tables.product.id, product.id),
                eq(tables.product.merchantId, this.user.merchantId),
                eq(tables.product.lastInventoryChangedAt, purchase.createdAt),
                eq(tables.product.updatedAt, product.updatedAt),
              ),
            );
          if (updatedProduct.affectedRows !== 1) {
            throw new ConcurrentUpdateError();
          }
        }

        for (const item of items) {
          const level = inventoryLevelsByVariantId.get(item.variantId)!;
          const [updatedLevel] = await trx
            .update(tables.inventoryLevel)
            .set({ onHand: sql`${tables.inventoryLevel.onHand} - ${item.quantity}`, updatedAt: voidedAt })
            .where(
              and(
                eq(tables.inventoryLevel.id, level.id),
                eq(tables.inventoryLevel.merchantId, this.user.merchantId),
                eq(tables.inventoryLevel.onHand, level.onHand),
                eq(tables.inventoryLevel.updatedAt, level.updatedAt),
                gte(tables.inventoryLevel.onHand, item.quantity),
              ),
            );
          if (updatedLevel.affectedRows !== 1) {
            throw new ConcurrentUpdateError();
          }
        }

        const [updatedPurchase] = await trx
          .update(tables.purchaseOrder)
          .set({ status: "voided", voidReason: reason, voidedById: employee.id, voidedAt, updatedAt: voidedAt })
          .where(
            and(
              eq(tables.purchaseOrder.id, id),
              eq(tables.purchaseOrder.merchantId, this.user.merchantId),
              eq(tables.purchaseOrder.status, "fulfilled"),
              eq(tables.purchaseOrder.updatedAt, purchase.updatedAt),
            ),
          );
        if (updatedPurchase.affectedRows !== 1) {
          throw new ConcurrentUpdateError();
        }

        await trx.insert(tables.inventoryMovement).values(
          items.map((item) => ({
            id: generateId({ model: "inventoryMovement" }),
            merchantId: this.user.merchantId,
            inventoryLevelId: inventoryLevelsByVariantId.get(item.variantId)!.id,
            referenceId: id,
            reason: "purchase_void" as const,
            fromState: "in_stock" as const,
            toState: "none" as const,
            quantityDelta: -item.quantity,
            unitCost: item.unitCost,
            createdById: employee.id,
            occurredAt: voidedAt,
            createdAt: voidedAt,
            updatedAt: voidedAt,
          })),
        );

        return ok(await assertFound(this.purchaseFinder.find(trx, { id, merchantId: this.user.merchantId })));
      },
      { isolationLevel: "read committed" },
    );
  }
}

export { VoidPurchaseRequest, VoidPurchaseService };
