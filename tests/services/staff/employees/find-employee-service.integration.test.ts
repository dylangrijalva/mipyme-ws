import { afterEach, describe, expect, it, vi } from "vitest";
import { tables } from "../../../../src/db/schema.ts";
import { FindEmployeeService } from "../../../../src/services/staff/employees/find-employee-service.ts";
import { generateId } from "../../../../src/utils/generate-id.ts";
import { insertEmployee, insertInvitation, setupEmployees } from "../../../test-utils/employee-fixture.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FindEmployeeService", () => {
  it("returns an archived employee with its PIN, locations, and latest invitation to any staff member", async () => {
    const { db, merchantId, managerId, waterSevenId, cashier, dependencies } = await setupEmployees();
    const id = await insertEmployee(db, { merchantId, name: "Sanji", status: "archived", pin: "2468" });
    await db.insert(tables.locationAccess).values({
      id: generateId({ model: "locationAccess" }),
      merchantId,
      employeeId: id,
      locationId: waterSevenId,
    });
    const invitationId = await insertInvitation(db, {
      merchantId,
      employeeId: id,
      invitedById: managerId,
      email: "sanji@baratie.example.com",
      status: "revoked",
    });

    const result = await FindEmployeeService.create(dependencies(cashier)).execute(id);

    expect(result).toMatchObject({
      success: true,
      value: {
        id,
        name: "Sanji",
        status: "archived",
        pin: "2468",
        locationIds: [waterSevenId],
        invitation: { id: invitationId, email: "sanji@baratie.example.com", status: "revoked" },
      },
    });
  });

  it.each([
    ["another merchant's employee", "foreign"],
    ["an unknown id", "unknown"],
  ] as const)("reports %s as not found", async (_, scenario) => {
    const { foreignEmployeeId, owner, dependencies } = await setupEmployees();
    const id = scenario === "foreign" ? foreignEmployeeId : generateId({ model: "employee" });

    const result = await FindEmployeeService.create(dependencies(owner)).execute(id);

    expect(result).toMatchObject({ success: false, error: { code: "resource_not_found" } });
  });
});
