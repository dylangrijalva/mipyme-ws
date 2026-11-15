import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { tables } from "../../src/db/schema.ts";
import { EmployeeFinder } from "../../src/finders/employee-finder.ts";
import { generateId } from "../../src/utils/generate-id.ts";
import { prepareDatabase } from "../prepare-db.ts";

const PREVIOUS_SYNCED_AT = new Date("2026-03-01T00:00:00Z");
const CURRENT_SYNCED_AT = new Date("2026-03-02T00:00:00Z");
const INSIDE_WINDOW = new Date("2026-03-01T12:00:00Z");
const BEFORE_WINDOW = new Date("2026-02-28T12:00:00Z");

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  const waterSevenId = generateId({ model: "location" });
  const loguetownId = generateId({ model: "location" });
  const foreignLocationId = generateId({ model: "location" });
  await db.insert(tables.location).values([
    { id: waterSevenId, merchantId, name: "Water 7" },
    { id: loguetownId, merchantId, name: "Loguetown" },
    { id: foreignLocationId, merchantId: otherMerchantId, name: "Wano Country" },
  ]);
  const accountId = generateId({ model: "account" });
  await db.insert(tables.account).values({
    id: accountId,
    merchantId,
    externalId: `user_${accountId}`,
    email: "nami@strawhatpirates.example.com",
  });
  return { db, merchantId, otherMerchantId, waterSevenId, loguetownId, foreignLocationId, accountId };
}

describe("EmployeeFinder", () => {
  it("returns every status ordered by id with account details and the ids of their assigned locations", async () => {
    const { db, merchantId, waterSevenId, loguetownId, accountId } = await setup();
    const finder = new EmployeeFinder();
    const timestamp = new Date("2026-01-01T00:00:00Z");
    const ownerId = "empl_0000000000000000001";
    const staffId = "empl_0000000000000000002";
    const invitedId = "empl_0000000000000000003";
    const disabledId = "empl_0000000000000000004";
    await db.insert(tables.employee).values([
      { id: disabledId, merchantId, name: "Sanji", status: "disabled", createdAt: timestamp, updatedAt: timestamp },
      { id: invitedId, merchantId, name: "Usopp", status: "invited", createdAt: timestamp, updatedAt: timestamp },
      {
        id: staffId,
        merchantId,
        name: "Nami",
        status: "enabled",
        permissions: "checkout view_transactions",
        maxDiscountRate: "0.15",
        accountId,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: ownerId,
        merchantId,
        name: "Monkey D. Luffy",
        isOwner: true,
        status: "enabled",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);
    await db.insert(tables.locationAccess).values([
      { id: generateId({ model: "locationAccess" }), merchantId, employeeId: staffId, locationId: loguetownId },
      { id: generateId({ model: "locationAccess" }), merchantId, employeeId: staffId, locationId: waterSevenId },
      { id: generateId({ model: "locationAccess" }), merchantId, employeeId: disabledId, locationId: waterSevenId },
    ]);

    const employees = await finder.findForSync(db, {
      merchantId,
      previousSyncedAt: null,
      currentSyncedAt: CURRENT_SYNCED_AT,
    });

    expect(employees).toEqual([
      {
        id: ownerId,
        name: "Monkey D. Luffy",
        isOwner: true,
        maxDiscountRate: "0.00",
        status: "enabled",
        permissions: [],
        account: null,
        locationIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: staffId,
        name: "Nami",
        isOwner: false,
        maxDiscountRate: "0.15",
        status: "enabled",
        permissions: ["checkout", "view_transactions"],
        account: { id: accountId, email: "nami@strawhatpirates.example.com" },
        locationIds: [waterSevenId, loguetownId].sort(),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      expect.objectContaining({ id: invitedId, status: "invited", locationIds: [] }),
      expect.objectContaining({ id: disabledId, status: "disabled", locationIds: [waterSevenId] }),
    ]);
  });

  it("excludes other merchants' employees and access rows", async () => {
    const { db, merchantId, otherMerchantId, waterSevenId, foreignLocationId } = await setup();
    const finder = new EmployeeFinder();
    const employeeId = generateId({ model: "employee" });
    const foreignEmployeeId = generateId({ model: "employee" });
    await db.insert(tables.employee).values([
      { id: employeeId, merchantId, name: "Nami", status: "enabled" },
      { id: foreignEmployeeId, merchantId: otherMerchantId, name: "Trafalgar Law", status: "enabled" },
    ]);
    await db.insert(tables.locationAccess).values([
      { id: generateId({ model: "locationAccess" }), merchantId, employeeId, locationId: waterSevenId },
      {
        id: generateId({ model: "locationAccess" }),
        merchantId: otherMerchantId,
        employeeId: foreignEmployeeId,
        locationId: foreignLocationId,
      },
    ]);

    const employees = await finder.findForSync(db, {
      merchantId,
      previousSyncedAt: null,
      currentSyncedAt: CURRENT_SYNCED_AT,
    });

    expect(employees).toMatchObject([{ id: employeeId, locationIds: [waterSevenId] }]);
  });

  it("returns only employees updated inside the inclusive sync window, with all of their access rows", async () => {
    const { db, merchantId, waterSevenId, loguetownId } = await setup();
    const finder = new EmployeeFinder();
    const lowerId = generateId({ model: "employee" });
    const upperId = generateId({ model: "employee" });
    const staleId = generateId({ model: "employee" });
    const futureId = generateId({ model: "employee" });
    await db.insert(tables.employee).values([
      { id: lowerId, merchantId, name: "Nami", updatedAt: PREVIOUS_SYNCED_AT },
      { id: upperId, merchantId, name: "Zoro", updatedAt: CURRENT_SYNCED_AT },
      { id: staleId, merchantId, name: "Sanji", updatedAt: BEFORE_WINDOW },
      { id: futureId, merchantId, name: "Usopp", updatedAt: new Date(CURRENT_SYNCED_AT.getTime() + 1) },
    ]);
    await db.insert(tables.locationAccess).values([
      { id: generateId({ model: "locationAccess" }), merchantId, employeeId: lowerId, locationId: waterSevenId },
      { id: generateId({ model: "locationAccess" }), merchantId, employeeId: lowerId, locationId: loguetownId },
      { id: generateId({ model: "locationAccess" }), merchantId, employeeId: staleId, locationId: waterSevenId },
    ]);

    const employees = await finder.findForSync(db, {
      merchantId,
      previousSyncedAt: PREVIOUS_SYNCED_AT,
      currentSyncedAt: CURRENT_SYNCED_AT,
    });

    expect(employees.map((employee) => employee.id).sort()).toEqual([lowerId, upperId].sort());
    expect(employees.find((employee) => employee.id === lowerId)?.locationIds.sort()).toEqual(
      [waterSevenId, loguetownId].sort(),
    );
    expect(employees.find((employee) => employee.id === upperId)?.locationIds).toEqual([]);
  });

  it("returns an employee whose linked account changed inside the window while the employee row is untouched", async () => {
    const { db, merchantId, accountId } = await setup();
    const employeeId = generateId({ model: "employee" });
    await db
      .insert(tables.employee)
      .values({ id: employeeId, merchantId, name: "Nami", accountId, updatedAt: BEFORE_WINDOW });
    await db.update(tables.account).set({ updatedAt: INSIDE_WINDOW }).where(eq(tables.account.id, accountId));

    const employees = await new EmployeeFinder().findForSync(db, {
      merchantId,
      previousSyncedAt: PREVIOUS_SYNCED_AT,
      currentSyncedAt: CURRENT_SYNCED_AT,
    });

    expect(employees).toMatchObject([{ id: employeeId, account: { id: accountId } }]);
  });

  it("returns an empty list when no employee changed in the window", async () => {
    const { db, merchantId } = await setup();
    await db
      .insert(tables.employee)
      .values({ id: generateId({ model: "employee" }), merchantId, name: "Nami", updatedAt: INSIDE_WINDOW });

    const employees = await new EmployeeFinder().findForSync(db, {
      merchantId,
      previousSyncedAt: new Date("2026-03-01T13:00:00Z"),
      currentSyncedAt: CURRENT_SYNCED_AT,
    });

    expect(employees).toEqual([]);
  });
});
