import { afterEach, describe, expect, it, vi } from "vitest";
import { ListReceivedInvitationsService } from "../../../../src/services/staff/invitations/list-received-invitations-service.ts";
import { insertEmployee, insertInvitation, NOW, setupEmployees } from "../../../test-utils/employee-fixture.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ListReceivedInvitationsService", () => {
  it("lists only pending, unexpired invitations sent to the token's email, from every business", async () => {
    const context = await setupEmployees();
    const { db, merchantId, otherMerchantId, managerId, cashierId, foreignEmployeeId, owner } = context;
    const email = "nami@strawhatpirates.example.com";
    const foreignStaffId = await insertEmployee(db, { merchantId: otherMerchantId, name: "Bepo", pin: "1212" });
    const pendingId = await insertInvitation(db, {
      merchantId,
      employeeId: cashierId,
      invitedById: managerId,
      email,
      status: "invited",
      createdAt: new Date(NOW.getTime() - 2000),
    });
    const foreignId = await insertInvitation(db, {
      merchantId: otherMerchantId,
      employeeId: foreignStaffId,
      invitedById: foreignEmployeeId,
      email,
      status: "invited",
      createdAt: new Date(NOW.getTime() - 1000),
    });
    for (const values of [
      { status: "invited" as const, expiresAt: NOW },
      { status: "revoked" as const },
      { status: "accepted" as const },
      { status: "invited" as const, email: "zoro@strawhatpirates.example.com" },
    ]) {
      await insertInvitation(db, { merchantId, employeeId: cashierId, invitedById: managerId, email, ...values });
    }

    const result = await ListReceivedInvitationsService.create({
      ...context.dependencies(owner),
      claims: { sub: "user_nami", email: "Nami@StrawHatPirates.example.com" },
    }).execute();

    expect(result).toEqual({
      success: true,
      value: {
        results: [
          {
            id: pendingId,
            email,
            status: "invited",
            expiresAt: expect.any(Date),
            createdAt: new Date(NOW.getTime() - 2000),
            merchant: { id: merchantId, name: "Baratie Market" },
            employee: { id: cashierId, name: "Nami" },
          },
          expect.objectContaining({
            id: foreignId,
            merchant: { id: otherMerchantId, name: "Heart Pirates" },
            employee: { id: foreignStaffId, name: "Bepo" },
          }),
        ],
        nextCursor: null,
        hasMore: false,
      },
    });
  });
});
