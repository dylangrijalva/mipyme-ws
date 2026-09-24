import z from "zod";

const InventoryPhysicalCount = z.object({
  id: z.string(),
  variantId: z.string(),
  locationId: z.string(),
  quantity: z.number(),
  createdBy: z.object({
    id: z.string(),
    name: z.string(),
  }),
  occurredAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

type InventoryPhysicalCount = z.infer<typeof InventoryPhysicalCount>;

export { InventoryPhysicalCount };
