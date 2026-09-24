import z from "zod";
import { Decimal } from "./decimal.ts";

const PurchaseOrder = z.object({
  id: z.string(),
  transactionNumber: z.number(),
  status: z.string(),
  locationId: z.string(),
  supplier: z.object({
    id: z.string(),
    name: z.string(),
  }),
  lineItems: z.array(
    z.object({
      productId: z.string(),
      productName: z.string(),
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
  createdAt: z.date(),
  updatedAt: z.date(),
});

type PurchaseOrder = z.infer<typeof PurchaseOrder>;

export { PurchaseOrder };
