import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codes } from "../../../../src/contracts/business-error.ts";
import { tables } from "../../../../src/db/schema.ts";
import {
  CreateEmployeeInvitationRequest,
  CreateEmployeeInvitationService,
} from "../../../../src/services/staff/employees/create-employee-invitation-service.ts";
import { generateId } from "../../../../src/utils/generate-id.ts";
import {
  DAY_IN_MS,
  insertEmployee,
  insertInvitation,
  NOW,
  readEmployee,
  readState,
  setupEmployees,
} from "../../../test-utils/employee-fixture.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

async function invite(
  context: Awaited<ReturnType<typeof setupEmployees>>,
  user: Awaited<ReturnType<typeof setupEmployees>>["owner"],
  employeeId: string,
  email: string,
) {
  return CreateEmployeeInvitationService.create(context.dependencies(user)).execute([
    employeeId,
    CreateEmployeeInvitationRequest.parse({ email }),
  ]);
}

describe("CreateEmployeeInvitationService", () => {
  it("stores a 7-day invitation, emails it, and publishes the employee with the pending invitation", async () => {
    const context = await setupEmployees();
    const { db, merchantId, cashierId, managerId, manager, broadcast, sendEmployeeInvitation } = context;

    const result = await invite(context, manager, cashierId, "  Nami@StrawHatPirates.example.com ");

    const expiresAt = new Date(NOW.getTime() + 7 * DAY_IN_MS);
    expect(result).toEqual({
      success: true,
      value: {
        id: expect.stringMatching(/^invt_/),
        employeeId: cashierId,
        email: "nami@strawhatpirates.example.com",
        status: "invited",
        expiresAt,
        acceptedAt: null,
        revokedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    const [stored] = await db
      .select()
      .from(tables.employeeInvitation)
      .where(eq(tables.employeeInvitation.id, result.value!.id));
    expect(stored).toMatchObject({ merchantId, invitedById: managerId, status: "invited" });
    expect((await readEmployee(db, cashierId)).updatedAt).toEqual(NOW);
    expect(sendEmployeeInvitation).toHaveBeenCalledExactlyOnceWith({
      invitationId: result.value!.id,
      to: "nami@strawhatpirates.example.com",
      employeeName: "Nami",
      inviterName: "Roronoa Zoro",
      merchantName: "Baratie Market",
      country: "co",
      expiresInDays: 7,
    });
    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: {
        type: "employee",
        snapshot: expect.objectContaining({
          id: cashierId,
          invitation: { id: result.value!.id, email: "nami@strawhatpirates.example.com", status: "invited", expiresAt },
        }),
      },
    });
  });

  it("replaces only this employee's pending invitation when an invitation is sent again", async () => {
    const context = await setupEmployees();
    const { db, merchantId, ownerId, managerId, cashierId, owner } = context;
    const coworkerPendingId = await insertInvitation(db, {
      merchantId,
      employeeId: managerId,
      invitedById: ownerId,
      email: "zoro@strawhatpirates.example.com",
      status: "invited",
    });

    const first = await invite(context, owner, cashierId, "nami@strawhatpirates.example.com");
    const second = await invite(context, owner, cashierId, "nami@navigators.example.com");

    const invitations = await db
      .select()
      .from(tables.employeeInvitation)
      .where(eq(tables.employeeInvitation.employeeId, cashierId));
    expect(invitations).toHaveLength(2);
    expect(invitations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.value!.id, status: "revoked", revokedAt: NOW }),
        expect.objectContaining({ id: second.value!.id, status: "invited", email: "nami@navigators.example.com" }),
      ]),
    );
    const [coworkerInvitation] = await db
      .select()
      .from(tables.employeeInvitation)
      .where(eq(tables.employeeInvitation.id, coworkerPendingId));
    expect(coworkerInvitation).toMatchObject({ status: "invited", revokedAt: null });
  });

  it.each([
    ["the owner", "owner"],
    ["an employee who already has an account", "linked"],
    ["an archived employee", "archived"],
    ["an employee when the email belongs to another account of the business", "taken email"],
  ] as const)("refuses to invite %s without storing or sending anything", async (_, scenario) => {
    const context = await setupEmployees();
    const { db, merchantId, ownerId, cashierId, owner, broadcast, sendEmployeeInvitation } = context;
    const employeeId = await (async () => {
      if (scenario === "owner") {
        return ownerId;
      }

      if (scenario === "archived") {
        return insertEmployee(db, { merchantId, name: "Usopp", status: "archived", pin: "3333" });
      }

      if (scenario === "linked") {
        const accountId = generateId({ model: "account" });
        await db
          .insert(tables.account)
          .values({ id: accountId, merchantId, externalId: "user_sanji", email: "sanji@baratie.example.com" });
        return insertEmployee(db, { merchantId, accountId, name: "Sanji", pin: "2468" });
      }

      return cashierId;
    })();
    const email = scenario === "taken email" ? "LUFFY@strawhatpirates.example.com" : "crew@baratie.example.com";
    const before = await readState(db);

    const result = await invite(context, owner, employeeId, email);

    expect(result).toMatchObject({ success: false, error: { code: codes.conflictError } });
    expect(await readState(db)).toEqual(before);
    expect(sendEmployeeInvitation).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("allows an email used by an account of another business", async () => {
    const context = await setupEmployees();
    await context.db.insert(tables.account).values({
      id: generateId({ model: "account" }),
      merchantId: context.otherMerchantId,
      externalId: "user_law",
      email: "nami@strawhatpirates.example.com",
    });

    const result = await invite(context, context.owner, context.cashierId, "nami@strawhatpirates.example.com");

    expect(result).toMatchObject({ success: true, value: { status: "invited" } });
  });

  it("rejects a staff member without manage_employees", async () => {
    const context = await setupEmployees();
    const before = await readState(context.db);

    const result = await invite(context, context.cashier, context.cashierId, "nami@strawhatpirates.example.com");

    expect(result).toMatchObject({ success: false, error: { code: codes.forbiddenError } });
    expect(await readState(context.db)).toEqual(before);
    expect(context.sendEmployeeInvitation).not.toHaveBeenCalled();
  });

  it("reports another merchant's employee as not found", async () => {
    const context = await setupEmployees();

    const result = await invite(context, context.owner, context.foreignEmployeeId, "law@heartpirates.example.com");

    expect(result).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    expect(context.sendEmployeeInvitation).not.toHaveBeenCalled();
  });

  it("keeps an expired invitation's history when replacing it", async () => {
    const context = await setupEmployees();
    const { db, merchantId, managerId, cashierId, owner } = context;
    const expiredId = await insertInvitation(db, {
      merchantId,
      employeeId: cashierId,
      invitedById: managerId,
      email: "nami@strawhatpirates.example.com",
      status: "invited",
      expiresAt: new Date(NOW.getTime() - 1),
      createdAt: new Date(NOW.getTime() - 8 * DAY_IN_MS),
    });

    const result = await invite(context, owner, cashierId, "nami@strawhatpirates.example.com");

    expect(result.success).toBe(true);
    const [expired] = await db
      .select()
      .from(tables.employeeInvitation)
      .where(eq(tables.employeeInvitation.id, expiredId));
    expect(expired).toMatchObject({ status: "revoked", revokedAt: NOW });
  });

  it.each(["", "nami", "nami@", "@strawhatpirates.example.com", "nami @example.com"])(
    "rejects the invalid email %j",
    (email) => {
      expect(CreateEmployeeInvitationRequest.safeParse({ email }).success).toBe(false);
    },
  );
});
