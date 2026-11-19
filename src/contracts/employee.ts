import z from "zod";
import { splitDistinct } from "../utils/split-distinct.ts";
import { Decimal } from "./decimal.ts";
import { EmployeeInvitationSummary } from "./employee-invitation.ts";
import { EmployeeStatus } from "./employee-status.ts";

const PERMISSIONS_DELIMITER = " " as const;

const Employee = z.object({
  id: z.string(),
  name: z.string(),
  isOwner: z.boolean(),
  pin: z.string(),
  maxDiscountRate: Decimal,
  status: EmployeeStatus,
  permissions: z
    .string()
    .nullish()
    .transform((value) => splitDistinct(value, PERMISSIONS_DELIMITER)),
  locationIds: z.string().array(),
  account: z
    .object({ id: z.string(), email: z.string(), phone: z.string().nullable(), phoneVerified: z.boolean() })
    .nullable()
    .default(null),
  invitation: EmployeeInvitationSummary.nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});

type Employee = z.infer<typeof Employee>;

export { Employee, PERMISSIONS_DELIMITER };
