import z from "zod";

const InventoryChangeType = z.union([z.literal("movement"), z.literal("physical_count")]);

type InventoryChangeType = z.infer<typeof InventoryChangeType>;

export { InventoryChangeType };
