import z from "zod";
import { Decimal } from "./decimal.ts";
import { PaymentMethod } from "./payment-method.ts";
import { SaleStatus } from "./sale-status.ts";
import { Source } from "./source.ts";

const Sale = z.object({
  id: z.string(),
  source: Source,
  businessDate: z.date(),
  status: SaleStatus,
  transactionNumber: z.number(),
  discountRate: Decimal.nullable(),
  locationId: z.string(),
  notes: z.string().nullable(),
  customer: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .nullable()
    .default(null),
  lineItems: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      variantId: z.string(),
      shortageQuantity: z.number().int().nonnegative(),
      price: Decimal,
      unitCost: Decimal,
      quantity: z.number(),
    }),
  ),
  payments: z.array(
    z.object({
      id: z.string(),
      method: PaymentMethod,
      amount: Decimal,
      exchangeRate: Decimal.nullable().default(null),
    }),
  ),
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

type Sale = z.infer<typeof Sale>;

export { Sale };
