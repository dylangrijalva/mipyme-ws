import z from "zod";
import { InvitationStatus } from "./invitation-status.ts";

const EmployeeInvitation = z.object({
  id: z.string(),
  employeeId: z.string(),
  email: z.string(),
  status: InvitationStatus,
  expiresAt: z.date(),
  acceptedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const EmployeeInvitationSummary = EmployeeInvitation.pick({ id: true, email: true, status: true, expiresAt: true });

const ReceivedInvitation = EmployeeInvitation.pick({
  id: true,
  email: true,
  status: true,
  expiresAt: true,
  createdAt: true,
}).extend({
  merchant: z.object({ id: z.string(), name: z.string() }),
  employee: z.object({ id: z.string(), name: z.string() }),
});

type EmployeeInvitation = z.infer<typeof EmployeeInvitation>;
type EmployeeInvitationSummary = z.infer<typeof EmployeeInvitationSummary>;
type ReceivedInvitation = z.infer<typeof ReceivedInvitation>;

export { EmployeeInvitation, EmployeeInvitationSummary, ReceivedInvitation };
