import z from "zod";

const AccountType = z.union([z.literal("owner"), z.literal("staff"), z.literal("internal")]);

type AccountType = z.infer<typeof AccountType>;

export { AccountType };
