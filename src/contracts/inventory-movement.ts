import z from "zod";
import { Decimal } from "./decimal.ts";
import { InventoryMovementReason } from "./inventory-movement-reason.ts";
import { InventoryState } from "./inventory-state.ts";

const InventoryMovement = z.object({
  id: z.string(),
  variantId: z.string(),
  locationId: z.string(),
  referenceId: z.string().nullable(),
  reason: InventoryMovementReason,
  fromState: InventoryState,
  toState: InventoryState,
  quantityDelta: z.number(),
  unitCost: Decimal,
  createdBy: z.object({
    id: z.string(),
    name: z.string(),
  }),
  occurredAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

type InventoryMovement = z.infer<typeof InventoryMovement>;

export { InventoryMovement };
