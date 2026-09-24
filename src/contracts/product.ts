import z from "zod";
import { Collection } from "./collection.ts";
import { Decimal } from "./decimal.ts";
import { OptionGroup } from "./option-group.ts";
import { Option } from "./option.ts";
import { ProductImage } from "./product-image.ts";
import { ProductStatus } from "./product-status.ts";
import { ProductType } from "./product-type.ts";
import { ProductVariant } from "./product-variant.ts";

const Product = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  unitCost: Decimal,
  price: Decimal,
  productType: ProductType,
  status: ProductStatus,
  imageUrl: ProductImage.nullable().default(null),
  collection: Collection.omit({
    slug: true,
    createdAt: true,
    updatedAt: true,
  })
    .nullable()
    .default(null),
  optionGroups: z
    .array(
      OptionGroup.omit({ slug: true }).extend({
        options: Option.omit({
          slug: true,
        })
          .array()
          .default([]),
      }),
    )
    .default([]),
  variants: z.array(ProductVariant).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
  archivedAt: z.date().nullable(),
});

type Product = z.infer<typeof Product>;

export { Product };
