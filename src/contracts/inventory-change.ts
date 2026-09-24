import z from "zod";
import { InventoryMovement } from "./inventory-movement.ts";
import { InventoryPhysicalCount } from "./inventory-physical-count.ts";

const InventoryChange = z.discriminatedUnion("type", [
  InventoryMovement.extend({
    type: z.literal("movement"),
  }),
  InventoryPhysicalCount.extend({
    type: z.literal("physical_count"),
  }),
]);

type InventoryChange = z.infer<typeof InventoryChange>;

export { InventoryChange };
