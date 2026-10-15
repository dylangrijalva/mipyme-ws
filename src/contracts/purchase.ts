import z from "zod";
import { Decimal } from "./decimal.ts";
import { PurchaseStatus } from "./purchase-status.ts";

const Purchase = z.object({
  id: z.string(),
  transactionNumber: z.number(),
  status: PurchaseStatus,
  locationId: z.string(),
  supplier: z.object({
    id: z.string(),
    name: z.string(),
  }),
  lineItems: z.array(
    z.object({
      id: z.string(),
      unitCost: Decimal,
      price: Decimal.nullable(),
      variants: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          quantity: z.number(),
        }),
      ),
    }),
  ),
  notes: z.string().nullable(),
  createdBy: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .nullable()
    .default(null),
  voidReason: z.string().nullable(),
  voidedBy: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .nullable()
    .default(null),
  voidedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

type Purchase = z.infer<typeof Purchase>;

export { Purchase };
