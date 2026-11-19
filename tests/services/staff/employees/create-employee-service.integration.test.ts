import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tables } from "../../../../src/db/schema.ts";
import {
  CreateEmployeeRequest,
  CreateEmployeeService,
} from "../../../../src/services/staff/employees/create-employee-service.ts";
import { generateId } from "../../../../src/utils/generate-id.ts";
import { insertEmployee, NOW, readState, setupEmployees } from "../../../test-utils/employee-fixture.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CreateEmployeeService", () => {
  it("creates an enabled, account-less employee with normalized fields and publishes the snapshot", async () => {
    const { db, merchantId, waterSevenId, loguetownId, owner, broadcast, dependencies } = await setupEmployees();
    const before = await readState(db);
    const request = CreateEmployeeRequest.parse({
      name: "  Sanji  ",
      pin: "2468",
      permissions: ["checkout", "apply_discounts", "checkout"],
      maxDiscountRate: "0.15",
      locationIds: [waterSevenId, loguetownId, waterSevenId],
      isOwner: true,
      status: "disabled",
    });

    const result = await CreateEmployeeService.create(dependencies(owner)).execute(request);

    expect(result.success).toBe(true);
    expect(result.value).toEqual({
      id: expect.stringMatching(/^empl_/),
      name: "Sanji",
      isOwner: false,
      pin: "2468",
      maxDiscountRate: "0.15",
      status: "enabled",
      permissions: ["checkout", "apply_discounts"],
      locationIds: [waterSevenId, loguetownId].sort(),
      account: null,
      invitation: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const id = result.value!.id;
    const [stored] = await db.select().from(tables.employee).where(eq(tables.employee.id, id));
    expect(stored).toMatchObject({ merchantId, accountId: null, permissions: "checkout apply_discounts" });
    const access = await db.select().from(tables.locationAccess).where(eq(tables.locationAccess.employeeId, id));
    expect(access.map((row) => row.locationId).sort()).toEqual([waterSevenId, loguetownId].sort());
    expect(access.every((row) => row.merchantId === merchantId)).toBe(true);
    const after = await readState(db);
    expect(after.employees).toEqual(expect.arrayContaining(before.employees));
    expect(after.employees).toHaveLength(before.employees.length + 1);
    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "employee", snapshot: result.value },
    });
  });

  it("applies empty permissions, a zero discount limit, and no locations by default", async () => {
    const { db, owner, dependencies } = await setupEmployees();

    const result = await CreateEmployeeService.create(dependencies(owner)).execute(
      CreateEmployeeRequest.parse({ name: "Usopp", pin: "3333" }),
    );

    expect(result.value).toMatchObject({ permissions: [], maxDiscountRate: "0.00", locationIds: [] });
    const [stored] = await db.select().from(tables.employee).where(eq(tables.employee.id, result.value!.id));
    expect(stored.permissions).toBeNull();
  });

  it("lets a staff member with manage_employees create employees", async () => {
    const { manager, dependencies } = await setupEmployees();

    const result = await CreateEmployeeService.create(dependencies(manager)).execute(
      CreateEmployeeRequest.parse({ name: "Usopp", pin: "3333" }),
    );

    expect(result).toMatchObject({ success: true, value: { name: "Usopp" } });
  });

  it("rejects a staff member without manage_employees without storing or publishing anything", async () => {
    const { db, cashier, broadcast, dependencies } = await setupEmployees();
    const before = await readState(db);

    const result = await CreateEmployeeService.create(dependencies(cashier)).execute(
      CreateEmployeeRequest.parse({ name: "Usopp", pin: "3333" }),
    );

    expect(result).toMatchObject({ success: false, error: { code: "forbidden_error" } });
    expect(await readState(db)).toEqual(before);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it.each([
    ["an enabled employee", "enabled"],
    ["a disabled employee", "disabled"],
  ] as const)("rejects a PIN held by %s of the merchant", async (_, status) => {
    const { db, merchantId, owner, broadcast, dependencies } = await setupEmployees();
    await insertEmployee(db, { merchantId, name: "Sanji", status, pin: "2468" });
    const before = await readState(db);

    const result = await CreateEmployeeService.create(dependencies(owner)).execute(
      CreateEmployeeRequest.parse({ name: "Usopp", pin: "2468" }),
    );

    expect(result).toMatchObject({ success: false, error: { code: "pin_already_exists" } });
    expect(await readState(db)).toEqual(before);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("reuses a PIN freed by an archived employee or held only by another merchant's employee", async () => {
    const { db, merchantId, owner, dependencies } = await setupEmployees();
    await insertEmployee(db, { merchantId, name: "Sanji", status: "archived", pin: "2468" });
    const service = CreateEmployeeService.create(dependencies(owner));

    const reused = await service.execute(CreateEmployeeRequest.parse({ name: "Usopp", pin: "2468" }));
    const foreign = await service.execute(CreateEmployeeRequest.parse({ name: "Chopper", pin: "7777" }));

    expect(reused).toMatchObject({ success: true, value: { pin: "2468" } });
    expect(foreign).toMatchObject({ success: true, value: { pin: "7777" } });
  });

  it.each([
    ["belongs to another merchant", "foreign"],
    ["does not exist", "unknown"],
  ] as const)("rejects a location that %s without storing the employee", async (_, scenario) => {
    const { db, waterSevenId, foreignLocationId, owner, broadcast, dependencies } = await setupEmployees();
    const locationId = scenario === "foreign" ? foreignLocationId : generateId({ model: "location" });
    const before = await readState(db);

    const result = await CreateEmployeeService.create(dependencies(owner)).execute(
      CreateEmployeeRequest.parse({ name: "Usopp", pin: "3333", locationIds: [waterSevenId, locationId] }),
    );

    expect(result).toMatchObject({ success: false, error: { code: "resource_not_found" } });
    expect(await readState(db)).toEqual(before);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("admits only one of two simultaneous creations that claim the same PIN", async () => {
    const { db, merchantId, owner, dependencies } = await setupEmployees();
    const service = CreateEmployeeService.create(dependencies(owner));

    const results = await Promise.all(
      ["Usopp", "Chopper"].map((name) => service.execute(CreateEmployeeRequest.parse({ name, pin: "3333" }))),
    );

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.find((result) => !result.success)?.error?.code).toBe("pin_already_exists");
    const holders = await db.select().from(tables.employee).where(eq(tables.employee.pin, "3333"));
    expect(holders).toEqual([expect.objectContaining({ merchantId })]);
  });

  it.each([
    ["a PIN with three digits", { pin: "482" }],
    ["a PIN with five digits", { pin: "48210" }],
    ["a PIN with letters", { pin: "48a1" }],
    ["a discount limit above 1.00", { maxDiscountRate: "1.01" }],
    ["an unknown permission", { permissions: ["launch_cannons"] }],
    ["a blank name", { name: "   " }],
  ])("rejects %s", (_, fields) => {
    const result = CreateEmployeeRequest.safeParse({ name: "Usopp", pin: "3333", ...fields });

    expect(result.success).toBe(false);
  });

  it("accepts the full discount range and the new manage_employees permission", () => {
    const result = CreateEmployeeRequest.safeParse({
      name: "Usopp",
      pin: "0000",
      maxDiscountRate: "1.00",
      permissions: ["manage_employees"],
    });

    expect(result.success).toBe(true);
  });
});
