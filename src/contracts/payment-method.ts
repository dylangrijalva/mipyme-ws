import z from "zod";

const PaymentMethod = z.union([
  z.literal("cash"),
  z.literal("cash_dollar"),
  z.literal("non_integrated_card"),
  z.literal("wire_transfer"),
]);

type PaymentMethod = z.infer<typeof PaymentMethod>;

export { PaymentMethod };
