import { and, eq, inArray } from "drizzle-orm";
import z from "zod";
import { codes, type BusinessError } from "../contracts/business-error.ts";
import { ObjectId } from "../contracts/object-id.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";
import { generateId } from "../utils/generate-id.ts";
import { err, ok, type Result } from "../utils/result.ts";

const MAX_STOCK_QUANTITY = 999_999_999;

const StockQuantity = z.number().int().min(0).max(MAX_STOCK_QUANTITY);

const InventoryLevelInput = z.object({
  locationId: ObjectId,
  onHand: StockQuantity.optional(),
  lowStockThreshold: StockQuantity.optional(),
  optimalStockLevel: StockQuantity.optional(),
});

type InventoryLevelInput = z.infer<typeof InventoryLevelInput>;

type ResolveInventoryLevelsRequest = {
  merchantId: string;
  variantId: string;
  inventoryLevels: Array<InventoryLevelInput>;
};

type ResolvedInventoryLevel = {
  id: string;
  isNew: boolean;
  locationId: string;
  onHand: number;
  initialStock: number;
  lowStockThreshold: number;
  optimalStockLevel: number;
};

type SaveInventoryLevelsRequest = {
  merchantId: string;
  variantId: string;
  unitCost: string;
  createdById: string;
  occurredAt: Date;
  inventoryLevels: Array<ResolvedInventoryLevel>;
};

class InventoryManagement {
  // Validates the requested levels against the stored ones without writing, so callers can reject
  // the whole request before any of their own writes happen.
  async resolveInventoryLevels(
    db: Database,
    request: ResolveInventoryLevelsRequest,
  ): Promise<Result<Array<ResolvedInventoryLevel>, BusinessError>> {
    const locationIds = request.inventoryLevels.map((inventoryLevel) => inventoryLevel.locationId);
    if (new Set(locationIds).size !== locationIds.length) {
      return err({
        code: codes.validationError,
        message: "Each location can only appear once in inventory levels.",
        details: [],
      });
    }

    if (locationIds.length === 0) {
      return ok([]);
    }

    const locations = await db
      .select({ id: tables.location.id })
      .from(tables.location)
      .where(and(eq(tables.location.merchantId, request.merchantId), inArray(tables.location.id, locationIds)));

    const knownLocationIds = new Set(locations.map((location) => location.id));
    const missingLocationId = locationIds.find((locationId) => !knownLocationIds.has(locationId));
    if (missingLocationId) {
      return err({
        code: codes.resourceNotFound,
        message: `Location ${missingLocationId} has not been found.`,
        details: [],
      });
    }

    // Every level is locked because initialization is decided across all locations, not only the requested ones.
    const storedLevels = await db
      .select()
      .from(tables.inventoryLevel)
      .where(
        and(
          eq(tables.inventoryLevel.merchantId, request.merchantId),
          eq(tables.inventoryLevel.variantId, request.variantId),
        ),
      )
      .for("update");

    const isInitialized = storedLevels.some((storedLevel) => storedLevel.lastInventoryAdjustmentAt !== null);
    const setsOnHand = request.inventoryLevels.some((inventoryLevel) => inventoryLevel.onHand !== undefined);
    if (isInitialized && setsOnHand) {
      return err({
        code: codes.validationError,
        message:
          "The on-hand quantity can only be set before the product's first inventory movement. Use inventory adjustments to change it.",
        details: [],
      });
    }

    const storedLevelsByLocationId = new Map(storedLevels.map((storedLevel) => [storedLevel.locationId, storedLevel]));
    const resolvedLevels = request.inventoryLevels.map((inventoryLevel): ResolvedInventoryLevel => {
      const storedLevel = storedLevelsByLocationId.get(inventoryLevel.locationId);
      const initialStock = inventoryLevel.onHand ?? 0;
      return {
        id: storedLevel?.id ?? generateId({ model: "inventoryLevel" }),
        isNew: storedLevel === undefined,
        locationId: inventoryLevel.locationId,
        onHand: (storedLevel?.onHand ?? 0) + initialStock,
        initialStock,
        lowStockThreshold: inventoryLevel.lowStockThreshold ?? storedLevel?.lowStockThreshold ?? 0,
        optimalStockLevel: inventoryLevel.optimalStockLevel ?? storedLevel?.optimalStockLevel ?? 0,
      };
    });

    // An optimal stock level of zero means the merchant has not set a restock target.
    const hasThresholdAboveTarget = resolvedLevels.some(
      (resolvedLevel) =>
        resolvedLevel.optimalStockLevel > 0 && resolvedLevel.lowStockThreshold >= resolvedLevel.optimalStockLevel,
    );
    if (hasThresholdAboveTarget) {
      return err({
        code: codes.validationError,
        message: "The low stock threshold must be lower than the optimal stock level.",
        details: [],
      });
    }

    return ok(resolvedLevels);
  }

  async saveInventoryLevels(db: Database, request: SaveInventoryLevelsRequest): Promise<void> {
    for (const inventoryLevel of request.inventoryLevels) {
      const hasInitialStock = inventoryLevel.initialStock > 0;
      const stockTimestamps = hasInitialStock
        ? { lastRestockAt: request.occurredAt, lastInventoryAdjustmentAt: request.occurredAt }
        : {};

      if (inventoryLevel.isNew) {
        await db.insert(tables.inventoryLevel).values({
          id: inventoryLevel.id,
          merchantId: request.merchantId,
          variantId: request.variantId,
          locationId: inventoryLevel.locationId,
          onHand: inventoryLevel.onHand,
          lowStockThreshold: inventoryLevel.lowStockThreshold,
          optimalStockLevel: inventoryLevel.optimalStockLevel,
          ...stockTimestamps,
          createdAt: request.occurredAt,
          updatedAt: request.occurredAt,
        });
      } else {
        await db
          .update(tables.inventoryLevel)
          .set({
            onHand: inventoryLevel.onHand,
            lowStockThreshold: inventoryLevel.lowStockThreshold,
            optimalStockLevel: inventoryLevel.optimalStockLevel,
            ...stockTimestamps,
            updatedAt: request.occurredAt,
          })
          .where(
            and(
              eq(tables.inventoryLevel.merchantId, request.merchantId),
              eq(tables.inventoryLevel.id, inventoryLevel.id),
            ),
          );
      }

      if (hasInitialStock) {
        await db.insert(tables.inventoryMovement).values({
          id: generateId({ model: "inventoryMovement" }),
          reason: "initial_stock",
          fromState: "none",
          toState: "in_stock",
          quantityDelta: inventoryLevel.initialStock,
          unitCost: request.unitCost,
          referenceId: null,
          createdById: request.createdById,
          inventoryLevelId: inventoryLevel.id,
          merchantId: request.merchantId,
          occurredAt: request.occurredAt,
          createdAt: request.occurredAt,
          updatedAt: request.occurredAt,
        });
      }
    }
  }
}

export { InventoryLevelInput, InventoryManagement, MAX_STOCK_QUANTITY, type ResolvedInventoryLevel };
