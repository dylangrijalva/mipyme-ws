import z from "zod";
import { Decimal } from "./decimal.ts";
import { InventoryLevel } from "./inventory-level.ts";
import { Option } from "./option.ts";

const ProductVariant = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  price: Decimal.nullable(),
  options: Option.omit({ slug: true }).array().default([]),
  inventoryLevels: InventoryLevel.array().default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

type ProductVariant = z.infer<typeof ProductVariant>;

export { ProductVariant };
