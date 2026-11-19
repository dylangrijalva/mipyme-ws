import { afterEach, describe, expect, it, vi } from "vitest";
import { InvitationFinder } from "../../src/finders/invitation-finder.ts";
import { insertInvitation, NOW, setupEmployees } from "../test-utils/employee-fixture.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InvitationFinder", () => {
  it("tells pending and expired invitations apart by their deadline when filtering by status", async () => {
    const { db, merchantId, managerId, cashierId } = await setupEmployees();
    const finder = new InvitationFinder();
    const email = "nami@strawhatpirates.example.com";
    const base = { merchantId, employeeId: cashierId, invitedById: managerId, email, status: "invited" as const };
    const pendingId = await insertInvitation(db, { ...base, expiresAt: new Date(NOW.getTime() + 1) });
    const expiredId = await insertInvitation(db, { ...base, expiresAt: NOW });

    const [pending, expired, pendingAsExpired, expiredAsPending] = await Promise.all([
      finder.find(db, { id: pendingId, status: "invited" }),
      finder.find(db, { id: expiredId, status: "expired" }),
      finder.find(db, { id: pendingId, status: "expired" }),
      finder.find(db, { id: expiredId, status: "invited" }),
    ]);

    expect(pending).toMatchObject({ id: pendingId, status: "invited" });
    expect(expired).toMatchObject({ id: expiredId, status: "expired" });
    expect(pendingAsExpired).toBeNull();
    expect(expiredAsPending).toBeNull();
  });

  it("matches the email regardless of case and surrounding spaces", async () => {
    const { db, merchantId, managerId, cashierId } = await setupEmployees();
    const id = await insertInvitation(db, {
      merchantId,
      employeeId: cashierId,
      invitedById: managerId,
      email: "nami@strawhatpirates.example.com",
      status: "invited",
    });

    const received = await new InvitationFinder().findReceived(db, { email: "  NAMI@StrawHatPirates.example.com " });

    expect(received.map((invitation) => invitation.id)).toEqual([id]);
  });
});
