import z from "zod";

const ProductImageSource = z.union([z.literal("managed"), z.literal("remote")]);

type ProductImageSource = z.infer<typeof ProductImageSource>;

export { ProductImageSource };
