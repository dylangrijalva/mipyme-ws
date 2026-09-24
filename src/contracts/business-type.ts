import z from "zod";

const BusinessType = z.union([
  z.literal("convenience_store"),
  z.literal("restaurant"),
  z.literal("coffee_shop"),
  z.literal("clothing_store"),
  z.literal("electronics_store"),
  z.literal("grocery_store"),
  z.literal("pharmacy"),
  z.literal("hardware_store"),
  z.literal("beauty_salon"),
  z.literal("bar"),
  z.literal("autoparts_store"),
  z.literal("sports_store"),
  z.literal("bookstore"),
  z.literal("jewelry_store"),
  z.literal("shoe_store"),
  z.literal("stationery_store"),
  z.literal("bakery"),
  z.literal("other"),
]);

type BusinessType = z.infer<typeof BusinessType>;

export { BusinessType };
