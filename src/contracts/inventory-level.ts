import z from "zod";

const InventoryLevel = z.object({
  id: z.string(),
  variantId: z.string(),
  locationId: z.string(),
  onHand: z.number(),
  lowStockThreshold: z.number(),
  optimalStockLevel: z.number(),
});

type InventoryLevel = z.infer<typeof InventoryLevel>;

export { InventoryLevel };
