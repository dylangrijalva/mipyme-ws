import { Decimal } from "./decimal.ts";
import z from "zod";
import { BusinessType } from "./business-type.ts";

const Location = z.object({
  id: z.string(),
  name: z.string(),
  businessType: BusinessType,
  address: z.string().nullable(),
  phone: z.string().nullable(),
  taxId: z.string().nullable(),
  taxRate: Decimal.nullable(),
  nextSaleNumber: z.number().int(),
  nextPurchaseOrderNumber: z.number().int(),
  allowBackorders: z.boolean().default(false),
  receiptHeaderText: z.string().nullable(),
  receiptFooterText: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

type Location = z.infer<typeof Location>;

export { Location };
