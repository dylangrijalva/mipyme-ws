import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codes } from "../../../../src/contracts/business-error.ts";
import type { StoredInvitationStatus } from "../../../../src/contracts/invitation-status.ts";
import { tables } from "../../../../src/db/schema.ts";
import { AcceptInvitationService } from "../../../../src/services/staff/invitations/accept-invitation-service.ts";
import { generateId } from "../../../../src/utils/generate-id.ts";
import { err } from "../../../../src/utils/result.ts";
import {
  insertInvitation,
  NOW,
  readEmployee,
  readState,
  setupEmployees,
} from "../../../test-utils/employee-fixture.ts";

const NAMI_CLAIMS = { sub: "user_nami", email: "Nami@StrawHatPirates.example.com" };

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup(status: StoredInvitationStatus = "invited", expiresAt?: Date) {
  const context = await setupEmployees();
  const invitationId = await insertInvitation(context.db, {
    merchantId: context.merchantId,
    employeeId: context.cashierId,
    invitedById: context.managerId,
    email: "nami@strawhatpirates.example.com",
    status,
    expiresAt,
  });
  const createService = (claims = NAMI_CLAIMS) =>
    AcceptInvitationService.create({ ...context.dependencies(context.owner), claims });
  return { ...context, invitationId, createService };
}

describe("AcceptInvitationService", () => {
  it("links a new account for the login to the employee and assigns the login as staff", async () => {
    const { db, merchantId, cashierId, invitationId, identity, broadcast, createService } = await setup();

    const result = await createService().execute(invitationId);

    expect(result.success).toBe(true);
    const [account] = await db.select().from(tables.account).where(eq(tables.account.externalId, "user_nami"));
    expect(account).toMatchObject({ merchantId, email: "nami@strawhatpirates.example.com", phone: null });
    expect(result.value).toMatchObject({
      id: cashierId,
      account: { id: account.id, email: "nami@strawhatpirates.example.com" },
      invitation: { id: invitationId, status: "accepted" },
    });
    expect(await readEmployee(db, cashierId)).toMatchObject({ accountId: account.id, updatedAt: NOW });
    const [invitation] = await db
      .select()
      .from(tables.employeeInvitation)
      .where(eq(tables.employeeInvitation.id, invitationId));
    expect(invitation).toMatchObject({ status: "accepted", acceptedAt: NOW });
    expect(identity.assignToMerchant).toHaveBeenCalledExactlyOnceWith({
      accountId: "user_nami",
      name: "Nami",
      merchantId,
      employeeId: cashierId,
      accountType: "staff",
    });
    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "employee", snapshot: result.value },
    });
  });

  it("reports an invitation sent to another email as not found without changes", async () => {
    const { db, invitationId, identity, createService } = await setup();
    const before = await readState(db);

    const result = await createService({ sub: "user_zoro", email: "zoro@strawhatpirates.example.com" }).execute(
      invitationId,
    );

    expect(result).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    expect(await readState(db)).toEqual(before);
    expect(identity.assignToMerchant).not.toHaveBeenCalled();
  });

  it.each([
    ["revoked", "revoked", undefined],
    ["expired", "invited", NOW],
  ] as const)("refuses a %s invitation without changes", async (_, status, expiresAt) => {
    const { db, invitationId, identity, createService } = await setup(status, expiresAt);
    const before = await readState(db);

    const result = await createService().execute(invitationId);

    expect(result).toMatchObject({ success: false, error: { code: codes.conflictError } });
    expect(await readState(db)).toEqual(before);
    expect(identity.assignToMerchant).not.toHaveBeenCalled();
  });

  it("refuses a login that already belongs to another business", async () => {
    const { db, otherMerchantId, invitationId, identity, createService } = await setup();
    await db.insert(tables.account).values({
      id: generateId({ model: "account" }),
      merchantId: otherMerchantId,
      externalId: "user_nami",
      email: "nami@cocoyasi.example.com",
    });
    const before = await readState(db);

    const result = await createService().execute(invitationId);

    expect(result).toMatchObject({ success: false, error: { code: codes.conflictError } });
    expect(await readState(db)).toEqual(before);
    expect(identity.assignToMerchant).not.toHaveBeenCalled();
  });

  it("refuses when another account of the business already uses the invited email", async () => {
    const { db, merchantId, invitationId, createService } = await setup();
    await db.insert(tables.account).values({
      id: generateId({ model: "account" }),
      merchantId,
      externalId: "user_nami_old",
      email: "nami@strawhatpirates.example.com",
    });
    const before = await readState(db);

    const result = await createService().execute(invitationId);

    expect(result).toMatchObject({ success: false, error: { code: codes.conflictError } });
    expect(await readState(db)).toEqual(before);
  });

  it.each([
    ["was archived", { status: "archived" as const }],
    ["already has an account", { linked: true }],
  ])("refuses when the employee %s", async (_, scenario) => {
    const { db, merchantId, cashierId, invitationId, createService } = await setup();
    if ("status" in scenario) {
      await db.update(tables.employee).set({ status: scenario.status }).where(eq(tables.employee.id, cashierId));
    }
    if ("linked" in scenario) {
      const accountId = generateId({ model: "account" });
      await db
        .insert(tables.account)
        .values({ id: accountId, merchantId, externalId: "user_other", email: "other@baratie.example.com" });
      await db.update(tables.employee).set({ accountId }).where(eq(tables.employee.id, cashierId));
    }
    const before = await readState(db);

    const result = await createService().execute(invitationId);

    expect(result).toMatchObject({ success: false, error: { code: codes.conflictError } });
    expect(await readState(db)).toEqual(before);
  });

  it("keeps the link when assigning the login fails and succeeds again on retry", async () => {
    const { db, merchantId, cashierId, invitationId, identity, broadcast, createService } = await setup();
    identity.assignToMerchant.mockResolvedValueOnce(
      err({ code: codes.rateLimitExceeded, message: "Too many account requests.", details: [] }),
    );

    const failed = await createService().execute(invitationId);
    const committed = await readState(db);
    const broadcastsAfterFailure = [...broadcast.mock.calls];
    const retried = await createService().execute(invitationId);

    const linkedAccount = committed.accounts.find((account) => account.externalId === "user_nami");
    expect(failed).toMatchObject({ success: false, error: { code: codes.rateLimitExceeded } });
    expect(broadcastsAfterFailure).toEqual([
      [
        {
          merchantId,
          resource: {
            type: "employee",
            snapshot: expect.objectContaining({
              id: cashierId,
              account: expect.objectContaining({ id: linkedAccount?.id }),
            }),
          },
        },
      ],
    ]);
    expect(committed.accounts.filter((account) => account.externalId === "user_nami")).toHaveLength(1);
    expect(retried).toMatchObject({ success: true, value: { id: cashierId, invitation: { status: "accepted" } } });
    expect(await readState(db)).toEqual(committed);
    expect(identity.assignToMerchant).toHaveBeenCalledTimes(2);
    expect(identity.assignToMerchant).toHaveBeenLastCalledWith(
      expect.objectContaining({ merchantId, employeeId: cashierId, accountType: "staff" }),
    );
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("links a single account when the same login accepts twice at once", async () => {
    const { db, cashierId, invitationId, identity, broadcast, createService } = await setup();

    const results = await Promise.all([createService().execute(invitationId), createService().execute(invitationId)]);

    for (const result of results) {
      expect(result).toMatchObject({ success: true, value: { id: cashierId, invitation: { status: "accepted" } } });
    }
    const accounts = await db.select().from(tables.account).where(eq(tables.account.externalId, "user_nami"));
    expect(accounts).toHaveLength(1);
    expect((await readEmployee(db, cashierId)).accountId).toBe(accounts[0].id);
    expect(identity.assignToMerchant).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("refuses an invitation already accepted by a different login", async () => {
    const { db, invitationId, createService } = await setup();
    await createService().execute(invitationId);
    const before = await readState(db);

    const result = await createService({ sub: "user_impostor", email: NAMI_CLAIMS.email }).execute(invitationId);

    expect(result).toMatchObject({ success: false, error: { code: codes.conflictError } });
    expect(await readState(db)).toEqual(before);
  });
});
