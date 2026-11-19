import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import { InventoryAdjustmentReason } from "../../contracts/inventory-adjustment-reason.ts";
import { InventoryLevel } from "../../contracts/inventory-level.ts";
import { InventoryMovement } from "../../contracts/inventory-movement.ts";
import type { InventoryState } from "../../contracts/inventory-state.ts";
import { ObjectId } from "../../contracts/object-id.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { ProductFinder } from "../../finders/product-finder.ts";
import type { RealtimeEventPublisher } from "../../integrations/realtime-event-publisher.ts";
import { generateId } from "../../utils/generate-id.ts";
import { now } from "../../utils/now.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";
import type { EmployeeManagement } from "../employee-management.ts";
import type { EmployeeAuthorizationService } from "../employee-authorization-service.ts";
import { MAX_STOCK_QUANTITY } from "../inventory-management.ts";

const MAX_LINE_ITEMS = 100;

const STOCK_REDUCING_REASONS: Array<InventoryAdjustmentReason> = ["damaged", "theft", "lost"];

const CreateInventoryAdjustmentsRequest = z.object({
  locationId: ObjectId,
  createdById: ObjectId.nullish(),
  lineItems: z
    .array(
      z.object({
        variantId: ObjectId,
        reason: InventoryAdjustmentReason,
        quantityDelta: z
          .number()
          .int()
          .min(-MAX_STOCK_QUANTITY)
          .max(MAX_STOCK_QUANTITY)
          .refine((quantityDelta) => quantityDelta !== 0, "Provide a quantity delta other than zero."),
        notes: z.string().trim().max(256).nullish(),
      }),
    )
    .min(1, { message: "At least one line item is required." })
    .max(MAX_LINE_ITEMS),
});

type CreateInventoryAdjustmentsRequest = z.infer<typeof CreateInventoryAdjustmentsRequest>;

type InventoryAdjustments = {
  movements: Array<InventoryMovement>;
  inventoryLevels: Array<InventoryLevel>;
};

type AdjustedInventory = InventoryAdjustments & {
  productIds: Array<string>;
};

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  employeeAuthorizationService: EmployeeAuthorizationService;
  publisher: RealtimeEventPublisher;
  productFinder: ProductFinder;
  employeeManagement: EmployeeManagement;
  user: CurrentUser;
};

class CreateInventoryAdjustmentsService extends BaseService<CreateInventoryAdjustmentsRequest, InventoryAdjustments> {
  private readonly db: Database;
  private readonly employeeAuthorizationService: EmployeeAuthorizationService;
  private readonly publisher: RealtimeEventPublisher;
  private readonly productFinder: ProductFinder;
  private readonly employeeManagement: EmployeeManagement;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    employeeAuthorizationService: EmployeeAuthorizationService,
    publisher: RealtimeEventPublisher,
    productFinder: ProductFinder,
    employeeManagement: EmployeeManagement,
    user: CurrentUser,
  ) {
    super(logger);
    this.db = db;
    this.employeeAuthorizationService = employeeAuthorizationService;
    this.publisher = publisher;
    this.productFinder = productFinder;
    this.employeeManagement = employeeManagement;
    this.user = user;
  }

  static create({
    logger,
    db,
    employeeAuthorizationService,
    publisher,
    productFinder,
    employeeManagement,
    user,
  }: InjectedDependencies): CreateInventoryAdjustmentsService {
    return new CreateInventoryAdjustmentsService(
      logger,
      db,
      employeeAuthorizationService,
      publisher,
      productFinder,
      employeeManagement,
      user,
    );
  }

  async execute(request: CreateInventoryAdjustmentsRequest): Promise<Result<InventoryAdjustments, BusinessError>> {
    const lineItemsValidation = this.validateLineItems(request);
    if (!lineItemsValidation.success) {
      return lineItemsValidation;
    }

    const creditedEmployeeId = await this.employeeManagement.resolveCreditedEmployeeId(this.db, {
      merchantId: this.user.merchantId,
      requestedEmployeeId: request.createdById,
      defaultEmployeeId: this.user.employeeId,
    });
    if (!creditedEmployeeId.success) {
      return creditedEmployeeId;
    }

    // Adjustments write off losses, so the employee they are credited to must be allowed to make them, even when
    // a shared device is signed in as someone else.
    const authorization = await this.employeeAuthorizationService.authorizePermission({
      employeeId: creditedEmployeeId.value,
      merchantId: this.user.merchantId,
      permission: "manage_inventory",
    });
    if (!authorization.success) {
      return err({
        code: codes.forbiddenError,
        message: "The employee does not have permission to adjust inventory.",
        details: [],
      });
    }

    const employee = authorization.value;
    const locationAuthorization = await this.employeeAuthorizationService.authorizeLocationAccess({
      employee,
      locationId: request.locationId,
    });
    if (!locationAuthorization.success && locationAuthorization.error.kind === "location_not_found") {
      return err({ code: codes.resourceNotFound, message: "The location has not been found.", details: [] });
    }

    if (!locationAuthorization.success) {
      return err({
        code: codes.forbiddenError,
        message: "The employee does not have access to this location.",
        details: [],
      });
    }

    const result = await this.db.transaction((trx) => this.adjustInventory(trx, request, employee), {
      isolationLevel: "read committed",
    });
    if (!result.success) {
      return result;
    }

    for (const productId of result.value.productIds) {
      const product = await this.productFinder.find(this.db, { merchantId: this.user.merchantId, id: productId });
      if (product) {
        this.publisher.broadcast({
          merchantId: this.user.merchantId,
          resource: { type: "product", snapshot: product },
        });
      }
    }

    return ok({ movements: result.value.movements, inventoryLevels: result.value.inventoryLevels });
  }

  private validateLineItems(request: CreateInventoryAdjustmentsRequest): Result<void, BusinessError> {
    const variantIds = request.lineItems.map((lineItem) => lineItem.variantId);
    if (new Set(variantIds).size !== variantIds.length) {
      return err({
        code: codes.validationError,
        message: "Each variant can only appear once in an inventory adjustment.",
        details: [],
      });
    }

    const details = request.lineItems.flatMap((lineItem, index) => [
      ...(STOCK_REDUCING_REASONS.includes(lineItem.reason) && lineItem.quantityDelta > 0
        ? [
            {
              code: codes.validationError,
              message: "Damaged, theft, and lost adjustments must reduce stock.",
              field: `lineItems.${index}.quantityDelta`,
            },
          ]
        : []),
      ...(lineItem.reason === "correction" && !lineItem.notes
        ? [
            {
              code: codes.validationError,
              message: "Explain why the stock is being corrected.",
              field: `lineItems.${index}.notes`,
            },
          ]
        : []),
    ]);
    if (details.length > 0) {
      return err({ code: codes.validationError, message: "One or more inventory adjustments are invalid.", details });
    }

    return ok(undefined);
  }

  private async adjustInventory(
    trx: Database,
    request: CreateInventoryAdjustmentsRequest,
    employee: { id: string; name: string },
  ): Promise<Result<AdjustedInventory, BusinessError>> {
    const variantIds = request.lineItems.map((lineItem) => lineItem.variantId);
    const variants = await trx
      .select({ id: tables.variant.id, productId: tables.variant.productId })
      .from(tables.variant)
      .where(
        and(
          eq(tables.variant.merchantId, this.user.merchantId),
          inArray(tables.variant.id, variantIds),
          isNull(tables.variant.archivedAt),
        ),
      );

    const productIds = [...new Set(variants.map((variant) => variant.productId))].sort();
    // Locking the products first serializes adjustments with sales and purchases, which also start from the
    // product rows, and keeps the unit cost stable while it is copied onto the movements.
    const products = productIds.length
      ? await trx
          .select()
          .from(tables.product)
          .where(
            and(
              eq(tables.product.merchantId, this.user.merchantId),
              inArray(tables.product.id, productIds),
              isNull(tables.product.archivedAt),
            ),
          )
          .orderBy(asc(tables.product.id))
          .for("update")
      : [];

    if (variants.length !== variantIds.length || products.length !== productIds.length) {
      return err({ code: codes.resourceNotFound, message: "One or more variants have not been found.", details: [] });
    }

    if (products.some((product) => product.type === "service")) {
      return err({
        code: codes.validationError,
        message: "Inventory adjustments can only contain item products.",
        details: [],
      });
    }

    const initializedVariants = await trx
      .selectDistinct({ variantId: tables.inventoryLevel.variantId })
      .from(tables.inventoryLevel)
      .where(
        and(
          eq(tables.inventoryLevel.merchantId, this.user.merchantId),
          inArray(tables.inventoryLevel.variantId, variantIds),
          isNotNull(tables.inventoryLevel.lastInventoryAdjustmentAt),
        ),
      );
    const initializedVariantIds = new Set(initializedVariants.map((variant) => variant.variantId));
    const uninitializedVariantIds = variantIds.filter((variantId) => !initializedVariantIds.has(variantId));
    if (uninitializedVariantIds.length > 0) {
      return err({
        code: codes.validationError,
        message: "Set the product's opening stock before adjusting its inventory.",
        details: uninitializedVariantIds.map((variantId) => ({
          code: codes.validationError,
          message: `Variant ${variantId} has no opening stock.`,
        })),
      });
    }

    const levels = await trx
      .select()
      .from(tables.inventoryLevel)
      .where(
        and(
          eq(tables.inventoryLevel.merchantId, this.user.merchantId),
          eq(tables.inventoryLevel.locationId, request.locationId),
          inArray(tables.inventoryLevel.variantId, variantIds),
        ),
      )
      .orderBy(asc(tables.inventoryLevel.variantId))
      .for("update");
    const levelsByVariantId = new Map(levels.map((level) => [level.variantId, level]));

    const shortages = request.lineItems
      .map((lineItem, index) => ({
        index,
        variantId: lineItem.variantId,
        shortage: -((levelsByVariantId.get(lineItem.variantId)?.onHand ?? 0) + lineItem.quantityDelta),
      }))
      .filter((line) => line.shortage > 0);
    if (shortages.length > 0) {
      return err({
        code: codes.stockInsufficient,
        message: "One or more adjustments would reduce stock below zero at this location.",
        details: shortages.map((line) => ({
          code: codes.stockInsufficient,
          message: `Variant ${line.variantId} is short by ${line.shortage}.`,
          field: `lineItems.${line.index}.quantityDelta`,
        })),
      });
    }

    const occurredAt = now();
    for (const product of products) {
      // Purchases recompute the average cost from the pooled on-hand and detect concurrent changes through the
      // product's updatedAt, so every on-hand change has to move it forward.
      await trx
        .update(tables.product)
        .set({ updatedAt: new Date(Math.max(occurredAt.getTime(), product.updatedAt.getTime() + 1)) })
        .where(and(eq(tables.product.merchantId, this.user.merchantId), eq(tables.product.id, product.id)));
    }

    const unitCostByVariantId = new Map(
      variants.map((variant) => [variant.id, products.find((product) => product.id === variant.productId)!.unitCost]),
    );

    const movements: Array<typeof tables.inventoryMovement.$inferInsert> = [];
    for (const lineItem of request.lineItems) {
      const level = levelsByVariantId.get(lineItem.variantId);
      const inventoryLevelId = level?.id ?? generateId({ model: "inventoryLevel" });
      // A positive correction is the only adjustment that brings stock in, so it counts as a restock for the
      // stock status without touching the product's restock time that guards sale voids.
      const restockTimestamp =
        lineItem.reason === "correction" && lineItem.quantityDelta > 0 ? { lastRestockAt: occurredAt } : {};

      if (level) {
        await trx
          .update(tables.inventoryLevel)
          .set({
            onHand: level.onHand + lineItem.quantityDelta,
            lastInventoryAdjustmentAt: occurredAt,
            updatedAt: occurredAt,
            ...restockTimestamp,
          })
          .where(
            and(eq(tables.inventoryLevel.merchantId, this.user.merchantId), eq(tables.inventoryLevel.id, level.id)),
          );
      } else {
        await trx.insert(tables.inventoryLevel).values({
          id: inventoryLevelId,
          merchantId: this.user.merchantId,
          variantId: lineItem.variantId,
          locationId: request.locationId,
          onHand: lineItem.quantityDelta,
          lastInventoryAdjustmentAt: occurredAt,
          createdAt: occurredAt,
          updatedAt: occurredAt,
          ...restockTimestamp,
        });
      }

      movements.push({
        id: generateId({ model: "inventoryMovement" }),
        merchantId: this.user.merchantId,
        inventoryLevelId,
        referenceId: null,
        notes: lineItem.notes || null,
        reason: lineItem.reason,
        ...movementStates(lineItem.reason, lineItem.quantityDelta),
        quantityDelta: lineItem.quantityDelta,
        unitCost: unitCostByVariantId.get(lineItem.variantId)!,
        createdById: employee.id,
        occurredAt,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      });
    }

    await trx.insert(tables.inventoryMovement).values(movements);

    const savedLevels = await trx
      .select()
      .from(tables.inventoryLevel)
      .where(
        and(
          eq(tables.inventoryLevel.merchantId, this.user.merchantId),
          eq(tables.inventoryLevel.locationId, request.locationId),
          inArray(tables.inventoryLevel.variantId, variantIds),
        ),
      )
      .orderBy(asc(tables.inventoryLevel.variantId));

    return ok({
      movements: request.lineItems.map((lineItem, index) =>
        InventoryMovement.parse({
          ...movements[index],
          variantId: lineItem.variantId,
          locationId: request.locationId,
          createdBy: { id: employee.id, name: employee.name },
        }),
      ),
      inventoryLevels: savedLevels.map((level) => InventoryLevel.parse(level)),
      productIds,
    });
  }
}

function movementStates(
  reason: InventoryAdjustmentReason,
  quantityDelta: number,
): { fromState: InventoryState; toState: InventoryState } {
  if (reason !== "correction") {
    return { fromState: "in_stock", toState: "waste" };
  }

  if (quantityDelta > 0) {
    return { fromState: "none", toState: "in_stock" };
  }

  return { fromState: "in_stock", toState: "none" };
}

export { CreateInventoryAdjustmentsRequest, CreateInventoryAdjustmentsService, type InventoryAdjustments };
