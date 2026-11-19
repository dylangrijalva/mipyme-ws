import z from "zod";
import { getStockStatus } from "./stock-status.ts";

const InventoryLevel = z
  .object({
    id: z.string(),
    variantId: z.string(),
    locationId: z.string(),
    onHand: z.number(),
    lowStockThreshold: z.number(),
    optimalStockLevel: z.number(),
    lastSoldAt: z.date().nullable(),
    lastRestockAt: z.date().nullable(),
    lastInventoryAdjustmentAt: z.date().nullable(),
  })
  .transform((inventoryLevel) => ({ ...inventoryLevel, stockStatus: getStockStatus(inventoryLevel) }));

type InventoryLevel = z.infer<typeof InventoryLevel>;

export { InventoryLevel };
