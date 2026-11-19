import z from "zod";

const InventoryMovementReason = z.union([
  z.literal("sale"),
  z.literal("sale_void"),
  z.literal("purchase"),
  z.literal("purchase_void"),
  z.literal("lost"),
  z.literal("damaged"),
  z.literal("theft"),
  z.literal("correction"),
  z.literal("initial_stock"),
]);

type InventoryMovementReason = z.infer<typeof InventoryMovementReason>;

export { InventoryMovementReason };
