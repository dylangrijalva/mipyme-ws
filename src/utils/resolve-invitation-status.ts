import type { InvitationStatus, StoredInvitationStatus } from "../contracts/invitation-status.ts";
import { now } from "./now.ts";

function resolveInvitationStatus(invitation: { status: StoredInvitationStatus; expiresAt: Date }): InvitationStatus {
  const hasExpired = invitation.status === "invited" && invitation.expiresAt.getTime() <= now().getTime();
  return hasExpired ? "expired" : invitation.status;
}

export { resolveInvitationStatus };
