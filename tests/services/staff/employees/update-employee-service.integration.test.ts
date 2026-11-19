import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codes } from "../../../../src/contracts/business-error.ts";
import { tables } from "../../../../src/db/schema.ts";
import {
  UpdateEmployeeRequest,
  UpdateEmployeeService,
} from "../../../../src/services/staff/employees/update-employee-service.ts";
import { generateId } from "../../../../src/utils/generate-id.ts";
import { err } from "../../../../src/utils/result.ts";
import {
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

async function update(
  context: Awaited<ReturnType<typeof setupEmployees>>,
  user: Awaited<ReturnType<typeof setupEmployees>>["owner"],
  id: string,
  body: Record<string, unknown>,
) {
  return UpdateEmployeeService.create(context.dependencies(user)).execute([id, UpdateEmployeeRequest.parse(body)]);
}

async function insertLinkedEmployee(context: Awaited<ReturnType<typeof setupEmployees>>) {
  const accountId = generateId({ model: "account" });
  await context.db.insert(tables.account).values({
    id: accountId,
    merchantId: context.merchantId,
    externalId: "user_sanji",
    email: "sanji@baratie.example.com",
  });
  const id = await insertEmployee(context.db, {
    merchantId: context.merchantId,
    accountId,
    name: "Sanji",
    status: "enabled",
    pin: "2468",
  });
  return { id, accountId };
}

describe("UpdateEmployeeService", () => {
  it("lets a manager change a staff member's profile, replacing locations and keeping omitted fields", async () => {
    const context = await setupEmployees();
    const { db, merchantId, cashierId, waterSevenId, loguetownId, manager, broadcast } = context;
    await db.insert(tables.locationAccess).values({
      id: generateId({ model: "locationAccess" }),
      merchantId,
      employeeId: cashierId,
      locationId: waterSevenId,
    });
    const before = await readState(db);

    const result = await update(context, manager, cashierId, {
      name: "  Cat Burglar Nami  ",
      permissions: ["checkout", "void_transaction"],
      maxDiscountRate: "0.05",
      locationIds: [loguetownId],
    });

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({
      id: cashierId,
      name: "Cat Burglar Nami",
      pin: "4821",
      status: "enabled",
      permissions: ["checkout", "void_transaction"],
      maxDiscountRate: "0.05",
      locationIds: [loguetownId],
      updatedAt: NOW,
    });
    const access = await db.select().from(tables.locationAccess).where(eq(tables.locationAccess.employeeId, cashierId));
    expect(access.map((row) => row.locationId)).toEqual([loguetownId]);
    const after = await readState(db);
    expect(after.employees.filter((employee) => employee.id !== cashierId)).toEqual(
      before.employees.filter((employee) => employee.id !== cashierId),
    );
    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "employee", snapshot: result.value },
    });
  });

  it("returns the unchanged employee for an empty body without publishing", async () => {
    const context = await setupEmployees();
    const before = await readState(context.db);

    const result = await update(context, context.owner, context.cashierId, {});

    expect(result).toMatchObject({ success: true, value: { id: context.cashierId, name: "Nami" } });
    expect(await readState(context.db)).toEqual(before);
    expect(context.broadcast).not.toHaveBeenCalled();
  });

  it("lets any staff member change only their own PIN", async () => {
    const context = await setupEmployees();

    const result = await update(context, context.cashier, context.cashierId, { pin: "9753" });

    expect(result).toMatchObject({ success: true, value: { pin: "9753" } });
    expect((await readEmployee(context.db, context.cashierId)).pin).toBe("9753");
  });

  it.each([
    ["their own name", "self", { name: "Nami the Navigator" }],
    ["their own PIN together with another field", "self", { pin: "9753", permissions: ["refund"] }],
    ["another employee's PIN", "manager", { pin: "9753" }],
  ] as const)("rejects a staff member without manage_employees changing %s", async (_, target, body) => {
    const context = await setupEmployees();
    const id = target === "self" ? context.cashierId : context.managerId;
    const before = await readState(context.db);

    const result = await update(context, context.cashier, id, body);

    expect(result).toMatchObject({ success: false, error: { code: codes.forbiddenError } });
    expect(await readState(context.db)).toEqual(before);
    expect(context.broadcast).not.toHaveBeenCalled();
  });

  it("lets a manager change their own permissions", async () => {
    const context = await setupEmployees();

    const result = await update(context, context.manager, context.managerId, {
      permissions: ["manage_employees", "void_transaction", "refund"],
    });

    expect(result).toMatchObject({
      success: true,
      value: { permissions: ["manage_employees", "void_transaction", "refund"] },
    });
  });

  it("rejects a manager editing the owner's employee", async () => {
    const context = await setupEmployees();
    const before = await readState(context.db);

    const result = await update(context, context.manager, context.ownerId, { name: "Straw Hat" });

    expect(result).toMatchObject({ success: false, error: { code: codes.forbiddenError } });
    expect(await readState(context.db)).toEqual(before);
  });

  it("lets the owner change only the name and PIN of their own employee", async () => {
    const context = await setupEmployees();

    const renamed = await update(context, context.owner, context.ownerId, { name: "Straw Hat Luffy", pin: "5656" });
    const before = await readState(context.db);
    const restricted = await Promise.all(
      [{ status: "disabled" }, { permissions: ["checkout"] }, { maxDiscountRate: "0.10" }, { locationIds: [] }].map(
        (body) => update(context, context.owner, context.ownerId, body),
      ),
    );

    expect(renamed).toMatchObject({ success: true, value: { name: "Straw Hat Luffy", pin: "5656", isOwner: true } });
    for (const result of restricted) {
      expect(result).toMatchObject({ success: false, error: { code: codes.validationError } });
    }
    expect(await readState(context.db)).toEqual(before);
  });

  it("rejects a PIN held by another enabled or disabled employee, but not one freed by archiving", async () => {
    const context = await setupEmployees();
    const { db, merchantId, cashierId, owner } = context;
    await insertEmployee(db, { merchantId, name: "Sanji", status: "disabled", pin: "2222" });
    await insertEmployee(db, { merchantId, name: "Usopp", status: "archived", pin: "3333" });

    const takenByEnabled = await update(context, owner, cashierId, { pin: "1111" });
    const takenByDisabled = await update(context, owner, cashierId, { pin: "2222" });
    const freedByArchived = await update(context, owner, cashierId, { pin: "3333" });
    const unchanged = await update(context, owner, cashierId, { pin: "3333", name: "Nami" });

    expect(takenByEnabled).toMatchObject({ success: false, error: { code: codes.pinAlreadyExists } });
    expect(takenByDisabled).toMatchObject({ success: false, error: { code: codes.pinAlreadyExists } });
    expect(freedByArchived).toMatchObject({ success: true, value: { pin: "3333" } });
    expect(unchanged).toMatchObject({ success: true, value: { pin: "3333" } });
  });

  it("keeps the login link and PIN when disabling an employee", async () => {
    const context = await setupEmployees();
    const { id, accountId } = await insertLinkedEmployee(context);

    const result = await update(context, context.owner, id, { status: "disabled" });

    expect(result).toMatchObject({
      success: true,
      value: { status: "disabled", pin: "2468", account: { id: accountId } },
    });
    expect(context.identity.removeFromMerchant).not.toHaveBeenCalled();
  });

  it("archives an employee by releasing the linked login and freeing the PIN", async () => {
    const context = await setupEmployees();
    const { db, merchantId, owner, identity, broadcast } = context;
    const { id, accountId } = await insertLinkedEmployee(context);

    const result = await update(context, owner, id, { status: "archived" });
    const reused = await update(context, owner, context.cashierId, { pin: "2468" });

    expect(result).toMatchObject({ success: true, value: { id, status: "archived", account: null } });
    expect(await readEmployee(db, id)).toMatchObject({ status: "archived", accountId: null, pin: "2468" });
    expect(await db.select().from(tables.account).where(eq(tables.account.id, accountId))).toEqual([]);
    expect(await db.select().from(tables.account).where(eq(tables.account.id, context.ownerAccountId))).toHaveLength(1);
    expect(identity.removeFromMerchant).toHaveBeenCalledExactlyOnceWith("user_sanji");
    expect(reused).toMatchObject({ success: true, value: { pin: "2468" } });
    expect(broadcast).toHaveBeenCalledWith({ merchantId, resource: { type: "employee", snapshot: result.value } });
  });

  it("archives an invited employee by revoking only the pending invitation", async () => {
    const context = await setupEmployees();
    const { db, merchantId, managerId, cashierId, owner, identity } = context;
    const earlierRevokedAt = new Date(NOW.getTime() - 2000);
    const replacedId = await insertInvitation(db, {
      merchantId,
      employeeId: cashierId,
      invitedById: managerId,
      email: "nami@strawhatpirates.example.com",
      status: "revoked",
      revokedAt: earlierRevokedAt,
      createdAt: new Date(NOW.getTime() - 3000),
    });
    const pendingId = await insertInvitation(db, {
      merchantId,
      employeeId: cashierId,
      invitedById: managerId,
      email: "nami@strawhatpirates.example.com",
      status: "invited",
    });
    const coworkerPendingId = await insertInvitation(db, {
      merchantId,
      employeeId: managerId,
      invitedById: context.ownerId,
      email: "zoro@strawhatpirates.example.com",
      status: "invited",
    });
    const foreignPendingId = await insertInvitation(db, {
      merchantId: context.otherMerchantId,
      employeeId: context.foreignEmployeeId,
      invitedById: context.foreignEmployeeId,
      email: "law@heartpirates.example.com",
      status: "invited",
    });

    const result = await update(context, owner, cashierId, { status: "archived" });

    expect(result).toMatchObject({
      success: true,
      value: { status: "archived", invitation: { id: pendingId, status: "revoked" } },
    });
    const invitations = await db
      .select()
      .from(tables.employeeInvitation)
      .where(eq(tables.employeeInvitation.employeeId, cashierId));
    expect(invitations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: pendingId, status: "revoked", revokedAt: NOW }),
        expect.objectContaining({ id: replacedId, status: "revoked", revokedAt: earlierRevokedAt }),
      ]),
    );
    const untouched = await db
      .select()
      .from(tables.employeeInvitation)
      .where(inArray(tables.employeeInvitation.id, [coworkerPendingId, foreignPendingId]));
    expect(untouched).toHaveLength(2);
    for (const invitation of untouched) {
      expect(invitation).toMatchObject({ status: "invited", revokedAt: null });
    }
    expect(identity.removeFromMerchant).not.toHaveBeenCalled();
  });

  it.each([
    ["returns an error", "error"],
    ["throws", "exception"],
  ] as const)("keeps and publishes the archive when clearing the released login %s", async (_, outcome) => {
    const context = await setupEmployees();
    const { id } = await insertLinkedEmployee(context);
    if (outcome === "error") {
      context.identity.removeFromMerchant.mockResolvedValue(
        err({ code: codes.internalServerError, message: "Clerk is unavailable.", details: [] }),
      );
    }
    if (outcome === "exception") {
      context.identity.removeFromMerchant.mockRejectedValue(new TypeError("fetch failed"));
    }

    const result = await update(context, context.owner, id, { status: "archived" });

    expect(result).toMatchObject({ success: true, value: { status: "archived", account: null } });
    expect(await readEmployee(context.db, id)).toMatchObject({ status: "archived", accountId: null });
    expect(context.broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId: context.merchantId,
      resource: { type: "employee", snapshot: result.value },
    });
  });

  it("restores an archived employee only with a PIN no one else holds", async () => {
    const context = await setupEmployees();
    const { db, merchantId, owner } = context;
    const id = await insertEmployee(db, { merchantId, name: "Usopp", status: "archived", pin: "4821" });

    const conflicting = await update(context, owner, id, { status: "enabled" });
    const withNewPin = await update(context, owner, id, { status: "enabled", pin: "3333" });

    expect(conflicting).toMatchObject({ success: false, error: { code: codes.pinAlreadyExists } });
    expect(withNewPin).toMatchObject({ success: true, value: { status: "enabled", pin: "3333" } });
  });

  it.each([
    ["another merchant's employee", "employee"],
    ["another merchant's location", "location"],
  ] as const)("reports %s as not found without changing anything", async (_, scenario) => {
    const context = await setupEmployees();
    const before = await readState(context.db);
    const id = scenario === "employee" ? context.foreignEmployeeId : context.cashierId;

    const result = await update(context, context.owner, id, { locationIds: [context.foreignLocationId] });

    expect(result).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    expect(await readState(context.db)).toEqual(before);
  });
});
