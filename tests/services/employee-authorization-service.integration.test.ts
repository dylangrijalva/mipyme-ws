import { describe, expect, it } from "vitest";
import { tables } from "../../src/db/schema.ts";
import { EmployeeAuthorizationService } from "../../src/services/employee-authorization-service.ts";
import { generateId } from "../../src/utils/generate-id.ts";
import { prepareDatabase } from "../prepare-db.ts";

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  const ownerId = generateId({ model: "employee" });
  const employeeId = generateId({ model: "employee" });
  const otherEmployeeId = generateId({ model: "employee" });
  const disabledEmployeeId = generateId({ model: "employee" });
  const foreignEmployeeId = generateId({ model: "employee" });
  const locationId = generateId({ model: "location" });
  const otherEmployeeLocationId = generateId({ model: "location" });
  const foreignLocationId = generateId({ model: "location" });

  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates" },
    { id: otherMerchantId, name: "Heart Pirates" },
  ]);
  await db.insert(tables.employee).values([
    { id: ownerId, merchantId, name: "Monkey D. Luffy", isOwner: true, status: "enabled" },
    {
      id: employeeId,
      merchantId,
      name: "Nami",
      isOwner: false,
      status: "enabled",
      permissions: "checkout view_transactions",
    },
    {
      id: otherEmployeeId,
      merchantId,
      name: "Roronoa Zoro",
      isOwner: false,
      status: "enabled",
      permissions: "checkout",
    },
    {
      id: disabledEmployeeId,
      merchantId,
      name: "Sanji",
      isOwner: false,
      status: "disabled",
      permissions: "checkout",
    },
    {
      id: foreignEmployeeId,
      merchantId: otherMerchantId,
      name: "Trafalgar Law",
      isOwner: false,
      status: "enabled",
      permissions: "checkout",
    },
  ]);
  await db.insert(tables.location).values([
    { id: locationId, merchantId, name: "Water 7" },
    { id: otherEmployeeLocationId, merchantId, name: "Dressrosa" },
    { id: foreignLocationId, merchantId: otherMerchantId, name: "Wano Country" },
  ]);
  await db.insert(tables.locationAccess).values([
    { id: generateId({ model: "locationAccess" }), merchantId, employeeId, locationId },
    {
      id: generateId({ model: "locationAccess" }),
      merchantId,
      employeeId: otherEmployeeId,
      locationId: otherEmployeeLocationId,
    },
    {
      id: generateId({ model: "locationAccess" }),
      merchantId: otherMerchantId,
      employeeId: foreignEmployeeId,
      locationId: foreignLocationId,
    },
  ]);

  return {
    db,
    merchantId,
    otherMerchantId,
    ownerId,
    employeeId,
    otherEmployeeId,
    disabledEmployeeId,
    foreignEmployeeId,
    locationId,
    otherEmployeeLocationId,
    foreignLocationId,
  };
}

describe("EmployeeAuthorizationService", () => {
  it("allows an enabled owner to bypass permission and location assignments", async () => {
    const context = await setup();
    const service = EmployeeAuthorizationService.create({ db: context.db });

    const permissionResult = await service.authorizePermission({
      employeeId: context.ownerId,
      merchantId: context.merchantId,
      permission: "void_transaction",
    });

    expect(permissionResult).toMatchObject({
      success: true,
      value: { id: context.ownerId, isOwner: true },
    });
    if (!permissionResult.success) {
      return;
    }

    const locationResult = await service.authorizeLocationAccess({
      employee: permissionResult.value,
      locationId: context.otherEmployeeLocationId,
    });

    expect(locationResult).toEqual({ success: true, value: undefined });
  });

  it("denies an owner access to a location owned by another merchant", async () => {
    const context = await setup();
    const service = EmployeeAuthorizationService.create({ db: context.db });
    const permissionResult = await service.authorizePermission({
      employeeId: context.ownerId,
      merchantId: context.merchantId,
      permission: "view_transactions",
    });

    expect(permissionResult.success).toBe(true);
    if (!permissionResult.success) {
      return;
    }

    const locationResult = await service.authorizeLocationAccess({
      employee: permissionResult.value,
      locationId: context.foreignLocationId,
    });

    expect(locationResult).toEqual({
      success: false,
      error: { kind: "location_not_found", locationId: context.foreignLocationId },
    });
  });

  it("allows an enabled employee with the permission to access an assigned location", async () => {
    const context = await setup();
    const service = EmployeeAuthorizationService.create({ db: context.db });

    const permissionResult = await service.authorizePermission({
      employeeId: context.employeeId,
      merchantId: context.merchantId,
      permission: "view_transactions",
    });

    expect(permissionResult).toMatchObject({
      success: true,
      value: { id: context.employeeId, isOwner: false },
    });
    if (!permissionResult.success) {
      return;
    }

    const locationResult = await service.authorizeLocationAccess({
      employee: permissionResult.value,
      locationId: context.locationId,
    });

    expect(locationResult).toEqual({ success: true, value: undefined });
  });

  it("denies unavailable employees, merchant mismatches, and missing permissions", async () => {
    const context = await setup();
    const service = EmployeeAuthorizationService.create({ db: context.db });
    const requests = [
      {
        employeeId: generateId({ model: "employee" }),
        merchantId: context.merchantId,
        permission: "checkout",
        error: { kind: "employee_unavailable" },
      },
      {
        employeeId: context.foreignEmployeeId,
        merchantId: context.merchantId,
        permission: "checkout",
        error: { kind: "employee_unavailable" },
      },
      {
        employeeId: context.disabledEmployeeId,
        merchantId: context.merchantId,
        permission: "checkout",
        error: { kind: "employee_unavailable" },
      },
      {
        employeeId: context.employeeId,
        merchantId: context.merchantId,
        permission: "void_transaction",
        error: { kind: "permission_denied", permission: "void_transaction" },
      },
    ] as const;

    for (const request of requests) {
      const result = await service.authorizePermission(request);

      expect(result).toEqual({ success: false, error: request.error });
    }
  });

  it("denies a location assigned to another employee or merchant", async () => {
    const context = await setup();
    const service = EmployeeAuthorizationService.create({ db: context.db });
    const permissionResult = await service.authorizePermission({
      employeeId: context.employeeId,
      merchantId: context.merchantId,
      permission: "checkout",
    });

    expect(permissionResult.success).toBe(true);
    if (!permissionResult.success) {
      return;
    }

    const locationIds = [context.otherEmployeeLocationId, context.foreignLocationId];
    for (const locationId of locationIds) {
      const result = await service.authorizeLocationAccess({ employee: permissionResult.value, locationId });

      expect(result).toEqual({ success: false, error: { kind: "location_access_denied", locationId } });
    }
  });
});
