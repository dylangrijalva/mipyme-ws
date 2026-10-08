import z from "zod";

const PurchaseStatus = z.union([z.literal("fulfilled"), z.literal("voided")]);

type PurchaseStatus = z.infer<typeof PurchaseStatus>;

export { PurchaseStatus };
