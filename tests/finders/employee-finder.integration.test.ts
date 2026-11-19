import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { tables } from "../../src/db/schema.ts";
import { EmployeeFinder } from "../../src/finders/employee-finder.ts";
import { generateId } from "../../src/utils/generate-id.ts";
import { prepareDatabase } from "../prepare-db.ts";
import { insertEmployee } from "../test-utils/employee-fixture.ts";

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
    phone: "+593987654321",
    phoneVerified: true,
  });
  return { db, merchantId, otherMerchantId, waterSevenId, loguetownId, foreignLocationId, accountId };
}

describe("EmployeeFinder", () => {
  it("returns every status ordered by id with PINs, account details, and the ids of their assigned locations", async () => {
    const { db, merchantId, waterSevenId, loguetownId, accountId } = await setup();
    const finder = new EmployeeFinder();
    const timestamp = new Date("2026-01-01T00:00:00Z");
    const ownerId = "empl_0000000000000000001";
    const staffId = "empl_0000000000000000002";
    const archivedId = "empl_0000000000000000003";
    const disabledId = "empl_0000000000000000004";
    const phonelessAccountId = generateId({ model: "account" });
    await db.insert(tables.account).values({
      id: phonelessAccountId,
      merchantId,
      externalId: `user_${phonelessAccountId}`,
      email: "sanji@strawhatpirates.example.com",
    });
    await db.insert(tables.employee).values([
      {
        id: disabledId,
        merchantId,
        name: "Sanji",
        status: "disabled",
        pin: "2222",
        accountId: phonelessAccountId,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: archivedId,
        merchantId,
        name: "Usopp",
        status: "archived",
        pin: "3333",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: staffId,
        merchantId,
        name: "Nami",
        status: "enabled",
        pin: "4821",
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
        pin: "0001",
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
        pin: "0001",
        maxDiscountRate: "0.00",
        status: "enabled",
        permissions: [],
        account: null,
        invitation: null,
        locationIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: staffId,
        name: "Nami",
        isOwner: false,
        pin: "4821",
        maxDiscountRate: "0.15",
        status: "enabled",
        permissions: ["checkout", "view_transactions"],
        account: {
          id: accountId,
          email: "nami@strawhatpirates.example.com",
          phone: "+593987654321",
          phoneVerified: true,
        },
        invitation: null,
        locationIds: [waterSevenId, loguetownId].sort(),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      expect.objectContaining({ id: archivedId, status: "archived", pin: "3333", locationIds: [] }),
      expect.objectContaining({
        id: disabledId,
        status: "disabled",
        account: {
          id: phonelessAccountId,
          email: "sanji@strawhatpirates.example.com",
          phone: null,
          phoneVerified: false,
        },
        locationIds: [waterSevenId],
      }),
    ]);
  });

  it("excludes other merchants' employees and access rows", async () => {
    const { db, merchantId, otherMerchantId, waterSevenId, foreignLocationId } = await setup();
    const finder = new EmployeeFinder();
    const employeeId = generateId({ model: "employee" });
    const foreignEmployeeId = generateId({ model: "employee" });
    await db.insert(tables.employee).values([
      { id: employeeId, merchantId, name: "Nami", status: "enabled", pin: "4821" },
      { id: foreignEmployeeId, merchantId: otherMerchantId, name: "Trafalgar Law", status: "enabled", pin: "4821" },
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
      { id: lowerId, merchantId, name: "Nami", pin: "4821", updatedAt: PREVIOUS_SYNCED_AT },
      { id: upperId, merchantId, name: "Zoro", pin: "1111", updatedAt: CURRENT_SYNCED_AT },
      { id: staleId, merchantId, name: "Sanji", pin: "2222", updatedAt: BEFORE_WINDOW },
      { id: futureId, merchantId, name: "Usopp", pin: "3333", updatedAt: new Date(CURRENT_SYNCED_AT.getTime() + 1) },
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
      .values({ id: employeeId, merchantId, name: "Nami", pin: "4821", accountId, updatedAt: BEFORE_WINDOW });
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
    await db.insert(tables.employee).values({
      id: generateId({ model: "employee" }),
      merchantId,
      name: "Nami",
      pin: "4821",
      updatedAt: INSIDE_WINDOW,
    });

    const employees = await new EmployeeFinder().findForSync(db, {
      merchantId,
      previousSyncedAt: new Date("2026-03-01T13:00:00Z"),
      currentSyncedAt: CURRENT_SYNCED_AT,
    });

    expect(employees).toEqual([]);
  });

  it("reports a phone number as existing when an employee of any merchant has an account with it", async () => {
    const { db, otherMerchantId, accountId, merchantId } = await setup();
    const finder = new EmployeeFinder();
    const lawAccountId = generateId({ model: "account" });
    await db.insert(tables.account).values({
      id: lawAccountId,
      merchantId: otherMerchantId,
      externalId: `user_${lawAccountId}`,
      email: "law@heartpirates.example.com",
      phone: "+573001234567",
    });
    await db.insert(tables.employee).values([
      { id: generateId({ model: "employee" }), merchantId, name: "Nami", pin: "4821", accountId },
      {
        id: generateId({ model: "employee" }),
        merchantId: otherMerchantId,
        name: "Law",
        pin: "4821",
        accountId: lawAccountId,
      },
    ]);

    const [namiPhone, lawPhone, unknownPhone] = await Promise.all([
      finder.exists(db, { phone: "+593987654321" }),
      finder.exists(db, { phone: "+573001234567" }),
      finder.exists(db, { phone: "+525512345678" }),
    ]);

    expect(namiPhone).toBe(true);
    expect(lawPhone).toBe(true);
    expect(unknownPhone).toBe(false);
  });

  it("does not report a phone number held only by an account without a linked employee", async () => {
    const { db } = await setup();
    const finder = new EmployeeFinder();

    const exists = await finder.exists(db, { phone: "+593987654321" });

    expect(exists).toBe(false);
  });

  it("finds a PIN holder by combining the merchant, PIN, status, and excluded-id filters", async () => {
    const { db, merchantId, otherMerchantId } = await setup();
    const finder = new EmployeeFinder();
    const namiId = await insertEmployee(db, { merchantId, name: "Nami", status: "enabled", pin: "4821" });
    await insertEmployee(db, { merchantId, name: "Usopp", status: "archived", pin: "3333" });
    await insertEmployee(db, { merchantId: otherMerchantId, name: "Law", status: "enabled", pin: "7777" });
    const holding: Array<"enabled" | "disabled"> = ["enabled", "disabled"];

    const [held, heldOnlyBySelf, archived, foreign] = await Promise.all([
      finder.exists(db, { merchantId, pin: "4821", statuses: holding }),
      finder.exists(db, { merchantId, pin: "4821", statuses: holding, excludedId: namiId }),
      finder.exists(db, { merchantId, pin: "3333", statuses: holding }),
      finder.exists(db, { merchantId, pin: "7777", statuses: holding }),
    ]);

    expect(held).toBe(true);
    expect(heldOnlyBySelf).toBe(false);
    expect(archived).toBe(false);
    expect(foreign).toBe(false);
  });

  it("embeds each employee's most recent invitation and reports it expired once its deadline passes", async () => {
    const { db, merchantId } = await setup();
    const finder = new EmployeeFinder();
    const ownerId = await insertEmployee(db, { merchantId, name: "Luffy", isOwner: true, pin: "0001" });
    const namiId = await insertEmployee(db, { merchantId, name: "Nami", pin: "4821" });
    const zoroId = await insertEmployee(db, { merchantId, name: "Zoro", pin: "1111" });
    const invitation = (employeeId: string, id: string, createdAt: Date, expiresAt: Date) => ({
      id,
      merchantId,
      employeeId,
      invitedById: ownerId,
      email: "crew@strawhatpirates.example.com",
      status: "invited" as const,
      expiresAt,
      createdAt,
      updatedAt: createdAt,
    });
    const olderId = generateId({ model: "employeeInvitation" });
    const latestId = generateId({ model: "employeeInvitation" });
    const expiredId = generateId({ model: "employeeInvitation" });
    await db
      .insert(tables.employeeInvitation)
      .values([
        invitation(namiId, olderId, new Date("2026-03-01T00:00:00Z"), new Date("2999-01-01T00:00:00Z")),
        invitation(namiId, latestId, new Date("2026-03-02T00:00:00Z"), new Date("2999-01-01T00:00:00Z")),
        invitation(zoroId, expiredId, new Date("2026-03-02T00:00:00Z"), new Date("2000-01-01T00:00:00Z")),
      ]);

    const employees = await finder.paginate(db, { merchantId, limit: 10 });

    const invitationsById = new Map(employees.results.map((employee) => [employee.id, employee.invitation]));
    expect(invitationsById.get(ownerId)).toBeNull();
    expect(invitationsById.get(namiId)).toMatchObject({ id: latestId, status: "invited" });
    expect(invitationsById.get(zoroId)).toMatchObject({ id: expiredId, status: "expired" });
  });
});
