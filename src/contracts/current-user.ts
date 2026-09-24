import z from "zod";
import { AccountType } from "./account-type.ts";

const CurrentUser = z.object({
  id: z.string(),
  email: z.string(),
  merchantId: z.string(),
  employeeId: z.string(),
  accountType: AccountType,
});

type CurrentUser = z.infer<typeof CurrentUser>;

export { CurrentUser };
