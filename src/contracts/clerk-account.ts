import z from "zod";
import { AccountType } from "./account-type.ts";

const ClerkAccount = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email().nullable(),
  pictureUrl: z.url(),
  publicMetadata: z.object({
    merchantId: z.string().optional(),
    employeeId: z.string().optional(),
    type: AccountType.optional(),
  }),
});

type ClerkAccount = z.infer<typeof ClerkAccount>;

export { ClerkAccount };
