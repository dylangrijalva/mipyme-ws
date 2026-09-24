import z from "zod";

const InventoryState = z.union([z.literal("none"), z.literal("in_stock"), z.literal("sold"), z.literal("waste")]);

type InventoryState = z.infer<typeof InventoryState>;

export { InventoryState };
