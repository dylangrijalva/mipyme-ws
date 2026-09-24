import z from "zod";

const CurrencyCode = z.union([
  z.literal("xxx"),
  z.literal("ars"),
  z.literal("bob"),
  z.literal("brl"),
  z.literal("bzd"),
  z.literal("clp"),
  z.literal("cop"),
  z.literal("crc"),
  z.literal("cup"),
  z.literal("dop"),
  z.literal("usd"),
  z.literal("gtq"),
  z.literal("hnl"),
  z.literal("htg"),
  z.literal("mxn"),
  z.literal("nio"),
  z.literal("pab"),
  z.literal("pen"),
  z.literal("pyg"),
  z.literal("uyu"),
  z.literal("ves"),
]);

type CurrencyCode = z.infer<typeof CurrencyCode>;

export { CurrencyCode };
