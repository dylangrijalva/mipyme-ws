import z from "zod";

const PRODUCT_IMAGE_URL_MAX_LENGTH = 2048;

const ProductImageUrlInput = z
  .string()
  .trim()
  .pipe(z.url({ protocol: /^https?$/ }).max(PRODUCT_IMAGE_URL_MAX_LENGTH));

const ProductImage = z.url().refine((url) => {
  const protocol = new URL(url).protocol;
  return protocol === "http:" || protocol === "https:";
}, "Provide a product image URL starting with http:// or https://.");

type ProductImage = z.infer<typeof ProductImage>;

export { PRODUCT_IMAGE_URL_MAX_LENGTH, ProductImage, ProductImageUrlInput };
