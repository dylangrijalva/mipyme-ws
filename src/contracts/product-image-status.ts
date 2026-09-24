import z from "zod";

const ProductImageStatus = z.union([z.literal("pending"), z.literal("available")]);

type ProductImageStatus = z.infer<typeof ProductImageStatus>;

export { ProductImageStatus };
