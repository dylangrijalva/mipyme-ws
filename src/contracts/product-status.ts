import z from "zod";

const ProductStatus = z.union([z.literal("active"), z.literal("draft"), z.literal("archived")]);

type ProductStatus = z.infer<typeof ProductStatus>;

export { ProductStatus };
