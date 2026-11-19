import z from "zod";

const StoredInvitationStatus = z.union([z.literal("invited"), z.literal("accepted"), z.literal("revoked")]);

const InvitationStatus = z.union([...StoredInvitationStatus.options, z.literal("expired")]);

type StoredInvitationStatus = z.infer<typeof StoredInvitationStatus>;

type InvitationStatus = z.infer<typeof InvitationStatus>;

export { InvitationStatus, StoredInvitationStatus };
