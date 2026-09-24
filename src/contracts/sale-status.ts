import z from "zod";

const SaleStatus = z.union([z.literal("fulfilled"), z.literal("pending"), z.literal("voided")]);

type SaleStatus = z.infer<typeof SaleStatus>;

export { SaleStatus };
