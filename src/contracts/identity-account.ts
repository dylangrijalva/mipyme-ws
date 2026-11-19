import z from "zod";
import { AccountType } from "./account-type.ts";

const IdentityAccount = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phoneNumbers: z.array(z.string()),
  pictureUrl: z.url(),
  publicMetadata: z.object({
    merchantId: z.string().optional(),
    employeeId: z.string().optional(),
    type: AccountType.optional(),
  }),
});

type IdentityAccount = z.infer<typeof IdentityAccount>;

export { IdentityAccount };
