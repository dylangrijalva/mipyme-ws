import z from "zod";

const InventoryAdjustmentReason = z.union([
  z.literal("damaged"),
  z.literal("theft"),
  z.literal("lost"),
  z.literal("correction"),
]);

type InventoryAdjustmentReason = z.infer<typeof InventoryAdjustmentReason>;

export { InventoryAdjustmentReason };
