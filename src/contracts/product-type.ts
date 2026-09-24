import z from "zod";

const ProductType = z.union([z.literal("item"), z.literal("service")]);

type ProductType = z.infer<typeof ProductType>;

export { ProductType };
