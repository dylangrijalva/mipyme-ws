import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codes } from "../../../../src/contracts/business-error.ts";
import type { StoredInvitationStatus } from "../../../../src/contracts/invitation-status.ts";
import { tables } from "../../../../src/db/schema.ts";
import { RevokeEmployeeInvitationService } from "../../../../src/services/staff/employees/revoke-employee-invitation-service.ts";
import { generateId } from "../../../../src/utils/generate-id.ts";
import {
  DAY_IN_MS,
  insertInvitation,
  NOW,
  readEmployee,
  readState,
  setupEmployees,
} from "../../../test-utils/employee-fixture.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup(status: StoredInvitationStatus = "invited", expiresAt?: Date) {
  const context = await setupEmployees();
  const revokedAt = status === "revoked" ? new Date(NOW.getTime() - 1000) : null;
  const invitationId = await insertInvitation(context.db, {
    merchantId: context.merchantId,
    employeeId: context.cashierId,
    invitedById: context.managerId,
    email: "nami@strawhatpirates.example.com",
    status,
    revokedAt,
    expiresAt,
    createdAt: new Date(NOW.getTime() - 2000),
    updatedAt: new Date(NOW.getTime() - 2000),
  });
  return { ...context, invitationId };
}

describe("RevokeEmployeeInvitationService", () => {
  it("revokes a pending invitation and publishes the employee", async () => {
    const { db, merchantId, cashierId, invitationId, manager, broadcast, dependencies } = await setup();

    const result = await RevokeEmployeeInvitationService.create(dependencies(manager)).execute({
      employeeId: cashierId,
      invitationId,
    });

    expect(result).toMatchObject({
      success: true,
      value: { id: invitationId, status: "revoked", revokedAt: NOW, updatedAt: NOW },
    });
    const [stored] = await db
      .select()
      .from(tables.employeeInvitation)
      .where(eq(tables.employeeInvitation.id, invitationId));
    expect(stored).toMatchObject({ status: "revoked", revokedAt: NOW });
    expect((await readEmployee(db, cashierId)).updatedAt).toEqual(NOW);
    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: {
        type: "employee",
        snapshot: expect.objectContaining({
          id: cashierId,
          invitation: expect.objectContaining({ status: "revoked" }),
        }),
      },
    });
  });

  it("revokes an expired invitation", async () => {
    const { cashierId, invitationId, owner, dependencies } = await setup(
      "invited",
      new Date(NOW.getTime() - DAY_IN_MS),
    );

    const result = await RevokeEmployeeInvitationService.create(dependencies(owner)).execute({
      employeeId: cashierId,
      invitationId,
    });

    expect(result).toMatchObject({ success: true, value: { status: "revoked", revokedAt: NOW } });
  });

  it("returns an already revoked invitation unchanged without publishing", async () => {
    const { db, cashierId, invitationId, owner, broadcast, dependencies } = await setup("revoked");
    const before = await readState(db);

    const result = await RevokeEmployeeInvitationService.create(dependencies(owner)).execute({
      employeeId: cashierId,
      invitationId,
    });

    expect(result).toMatchObject({
      success: true,
      value: { status: "revoked", revokedAt: new Date(NOW.getTime() - 1000) },
    });
    expect(await readState(db)).toEqual(before);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("refuses to revoke an accepted invitation", async () => {
    const { db, cashierId, invitationId, owner, dependencies } = await setup("accepted");
    const before = await readState(db);

    const result = await RevokeEmployeeInvitationService.create(dependencies(owner)).execute({
      employeeId: cashierId,
      invitationId,
    });

    expect(result).toMatchObject({ success: false, error: { code: codes.conflictError } });
    expect(await readState(db)).toEqual(before);
  });

  it.each([
    ["an invitation of another employee", "employee"],
    ["an unknown invitation", "invitation"],
  ] as const)("reports %s as not found", async (_, scenario) => {
    const { managerId, cashierId, invitationId, owner, dependencies } = await setup();

    const result = await RevokeEmployeeInvitationService.create(dependencies(owner)).execute({
      employeeId: scenario === "employee" ? managerId : cashierId,
      invitationId: scenario === "invitation" ? generateId({ model: "employeeInvitation" }) : invitationId,
    });

    expect(result).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
  });

  it("rejects a staff member without manage_employees", async () => {
    const { db, cashierId, invitationId, cashier, dependencies } = await setup();
    const before = await readState(db);

    const result = await RevokeEmployeeInvitationService.create(dependencies(cashier)).execute({
      employeeId: cashierId,
      invitationId,
    });

    expect(result).toMatchObject({ success: false, error: { code: codes.forbiddenError } });
    expect(await readState(db)).toEqual(before);
  });
});
