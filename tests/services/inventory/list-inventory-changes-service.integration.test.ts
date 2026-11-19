import { eq, inArray, sql } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import type { CurrentUser } from "../../../src/contracts/current-user.ts";
import { InventoryChangePaginationRequest } from "../../../src/contracts/inventory-change-pagination-query.ts";
import type { InventoryMovementReason } from "../../../src/contracts/inventory-movement-reason.ts";
import { tables } from "../../../src/db/schema.ts";
import { InventoryChangeFinder } from "../../../src/finders/inventory-change-finder.ts";
import { ListInventoryChangesService } from "../../../src/services/inventory/list-inventory-changes-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import { EmployeeAuthorizationService } from "../../../src/services/employee-authorization-service.ts";

const at = (minute: number) => new Date(`2026-11-19T15:${String(minute).padStart(2, "0")}:00.000Z`);

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  const ownerId = generateId({ model: "employee" });
  const auditorId = generateId({ model: "employee" });
  const clerkId = generateId({ model: "employee" });
  const foreignOwnerId = generateId({ model: "employee" });
  const waterSevenId = generateId({ model: "location" });
  const dressrosaId = generateId({ model: "location" });
  const foreignLocationId = generateId({ model: "location" });
  const mandarinsVariantId = generateId({ model: "variant" });
  const riceVariantId = generateId({ model: "variant" });
  const foreignVariantId = generateId({ model: "variant" });
  const mandarinsAtWaterSevenId = generateId({ model: "inventoryLevel" });
  const riceAtWaterSevenId = generateId({ model: "inventoryLevel" });
  const mandarinsAtDressrosaId = generateId({ model: "inventoryLevel" });
  const foreignLevelId = generateId({ model: "inventoryLevel" });
  const saleId = generateId({ model: "sale" });

  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  await db.insert(tables.employee).values([
    { id: ownerId, merchantId, name: "Monkey D. Luffy", isOwner: true, status: "enabled", pin: "0001" },
    {
      id: auditorId,
      merchantId,
      name: "Nami",
      status: "enabled",
      pin: "4821",
      permissions: "view_inventory_reports",
    },
    { id: clerkId, merchantId, name: "Nico Robin", status: "enabled", pin: "2222", permissions: "manage_inventory" },
    {
      id: foreignOwnerId,
      merchantId: otherMerchantId,
      name: "Trafalgar Law",
      isOwner: true,
      status: "enabled",
      pin: "7777",
    },
  ]);
  await db.insert(tables.location).values([
    { id: waterSevenId, merchantId, name: "Water 7" },
    { id: dressrosaId, merchantId, name: "Dressrosa" },
    { id: foreignLocationId, merchantId: otherMerchantId, name: "Polar Tang" },
  ]);
  await db
    .insert(tables.locationAccess)
    .values([
      { id: generateId({ model: "locationAccess" }), merchantId, employeeId: auditorId, locationId: waterSevenId },
    ]);
  const mandarinsId = generateId({ model: "product" });
  const riceId = generateId({ model: "product" });
  const foreignProductId = generateId({ model: "product" });
  await db.insert(tables.product).values([
    { id: mandarinsId, merchantId, name: "Nami's mandarins", slug: mandarinsId, price: "30.00", unitCost: "8.00" },
    { id: riceId, merchantId, name: "Sanji's rice", slug: riceId, price: "12.00", unitCost: "5.00" },
    {
      id: foreignProductId,
      merchantId: otherMerchantId,
      name: "Law's scalpels",
      slug: foreignProductId,
      price: "40.00",
      unitCost: "20.00",
    },
  ]);
  await db.insert(tables.variant).values([
    { id: mandarinsVariantId, merchantId, productId: mandarinsId, name: "Nami's mandarins", price: "30.00" },
    { id: riceVariantId, merchantId, productId: riceId, name: "Sanji's rice", price: "12.00" },
    {
      id: foreignVariantId,
      merchantId: otherMerchantId,
      productId: foreignProductId,
      name: "Law's scalpels",
      price: "40.00",
    },
  ]);
  // Current on-hand matches the sum of each level's movements, as every write path guarantees.
  await db.insert(tables.inventoryLevel).values([
    { id: mandarinsAtWaterSevenId, merchantId, locationId: waterSevenId, variantId: mandarinsVariantId, onHand: 10 },
    { id: riceAtWaterSevenId, merchantId, locationId: waterSevenId, variantId: riceVariantId, onHand: 3 },
    { id: mandarinsAtDressrosaId, merchantId, locationId: dressrosaId, variantId: mandarinsVariantId, onHand: 5 },
    {
      id: foreignLevelId,
      merchantId: otherMerchantId,
      locationId: foreignLocationId,
      variantId: foreignVariantId,
      onHand: 9,
    },
  ]);

  const movement = (
    inventoryLevelId: string,
    minute: number,
    reason: InventoryMovementReason,
    quantityDelta: number,
    extra: Partial<typeof tables.inventoryMovement.$inferInsert> = {},
  ) => ({
    id: generateId({ model: "inventoryMovement" }),
    merchantId,
    inventoryLevelId,
    reason,
    fromState: quantityDelta > 0 ? ("none" as const) : ("in_stock" as const),
    toState: quantityDelta > 0 ? ("in_stock" as const) : ("waste" as const),
    quantityDelta,
    unitCost: "8.00",
    createdById: ownerId,
    occurredAt: at(minute),
    createdAt: at(minute),
    updatedAt: at(minute),
    ...extra,
  });
  const opening = movement(mandarinsAtWaterSevenId, 1, "initial_stock", 10);
  const sale = movement(mandarinsAtWaterSevenId, 2, "sale", -2, { referenceId: saleId, toState: "sold" });
  const riceOpening = movement(riceAtWaterSevenId, 3, "initial_stock", 4, { unitCost: "5.00" });
  const damage = movement(mandarinsAtWaterSevenId, 4, "damaged", -1, { notes: "Water leak", createdById: clerkId });
  const theft = movement(riceAtWaterSevenId, 5, "theft", -1, { unitCost: "5.00", createdById: clerkId });
  const correction = movement(mandarinsAtWaterSevenId, 6, "correction", 3, { notes: "Found a crate" });
  const transferIn = movement(mandarinsAtDressrosaId, 7, "correction", 5, { notes: "Moved from Water 7" });
  const foreign = {
    ...movement(foreignLevelId, 8, "initial_stock", 9),
    merchantId: otherMerchantId,
    createdById: foreignOwnerId,
  };
  await db
    .insert(tables.inventoryMovement)
    .values([opening, sale, riceOpening, damage, theft, correction, transferIn, foreign]);

  const createUser = (employeeId: string, accountType: CurrentUser["accountType"]): CurrentUser => ({
    id: generateId({ model: "account" }),
    email: "crew@strawhatpirates.example.com",
    merchantId,
    employeeId,
    accountType,
  });
  const createService = (user: CurrentUser) =>
    ListInventoryChangesService.create({
      logger: pino({ enabled: false }),
      db,
      employeeAuthorizationService: EmployeeAuthorizationService.create({ db }),
      user,
      inventoryChangeFinder: new InventoryChangeFinder(),
    });
  const list = (user: CurrentUser, query: Record<string, string | number> = {}) =>
    createService(user).execute(InventoryChangePaginationRequest.parse(query));

  return {
    db,
    merchantId,
    ownerId,
    clerkId,
    waterSevenId,
    dressrosaId,
    mandarinsVariantId,
    riceVariantId,
    mandarinsAtWaterSevenId,
    saleId,
    movements: { opening, sale, riceOpening, damage, theft, correction, transferIn },
    owner: createUser(ownerId, "owner"),
    auditor: createUser(auditorId, "staff"),
    clerk: createUser(clerkId, "staff"),
    list,
  };
}

describe("ListInventoryChangesService", () => {
  it("lists the merchant's movements newest first with the on-hand after each one", async () => {
    const context = await setup();

    const result = await context.list(context.owner);

    expect(result.value?.hasMore).toBe(false);
    expect(result.value?.nextCursor).toBeNull();
    expect(
      result.value?.results.map((change) => ({
        id: change.id,
        onHandAfter: change.type === "movement" ? change.onHandAfter : null,
      })),
    ).toEqual([
      { id: context.movements.transferIn.id, onHandAfter: 5 },
      { id: context.movements.correction.id, onHandAfter: 10 },
      { id: context.movements.theft.id, onHandAfter: 3 },
      { id: context.movements.damage.id, onHandAfter: 7 },
      { id: context.movements.riceOpening.id, onHandAfter: 4 },
      { id: context.movements.sale.id, onHandAfter: 8 },
      { id: context.movements.opening.id, onHandAfter: 10 },
    ]);
    expect(result.value?.results[3]).toEqual({
      type: "movement",
      id: context.movements.damage.id,
      variantId: context.mandarinsVariantId,
      locationId: context.waterSevenId,
      referenceId: null,
      notes: "Water leak",
      reason: "damaged",
      fromState: "in_stock",
      toState: "waste",
      quantityDelta: -1,
      unitCost: "8.00",
      onHandAfter: 7,
      createdBy: { id: context.clerkId, name: "Nico Robin" },
      occurredAt: at(4),
      createdAt: at(4),
      updatedAt: at(4),
    });
    expect(result.value?.results[5]).toMatchObject({ reason: "sale", referenceId: context.saleId, notes: null });
  });

  it("pages through the history without repeating entries and keeps balances exact on later pages", async () => {
    const context = await setup();

    const first = await context.list(context.owner, { limit: 3 });
    const second = await context.list(context.owner, { limit: 3, cursor: first.value!.nextCursor! });
    const third = await context.list(context.owner, { limit: 3, cursor: second.value!.nextCursor! });

    const summarize = (page: typeof first) =>
      page.value?.results.map((change) => [change.id, change.type === "movement" ? change.onHandAfter : null]);
    expect(first.value?.hasMore).toBe(true);
    expect(summarize(first)).toEqual([
      [context.movements.transferIn.id, 5],
      [context.movements.correction.id, 10],
      [context.movements.theft.id, 3],
    ]);
    expect(second.value?.hasMore).toBe(true);
    expect(summarize(second)).toEqual([
      [context.movements.damage.id, 7],
      [context.movements.riceOpening.id, 4],
      [context.movements.sale.id, 8],
    ]);
    expect(third.value).toMatchObject({ hasMore: false, nextCursor: null });
    expect(summarize(third)).toEqual([[context.movements.opening.id, 10]]);
  });

  it("keeps balances exact when filters hide newer movements of the same level", async () => {
    const context = await setup();

    const result = await context.list(context.owner, { reasons: "damaged,theft,lost" });

    expect(
      result.value?.results.map((change) => [change.id, change.type === "movement" ? change.onHandAfter : null]),
    ).toEqual([
      [context.movements.theft.id, 3],
      [context.movements.damage.id, 7],
    ]);
  });

  it.each([
    {
      scenario: "variants",
      query: (context: Awaited<ReturnType<typeof setup>>) => ({ variantIds: context.riceVariantId }),
      expected: ["theft", "riceOpening"] as const,
    },
    {
      scenario: "locations",
      query: (context: Awaited<ReturnType<typeof setup>>) => ({ locationIds: context.dressrosaId }),
      expected: ["transferIn"] as const,
    },
    {
      scenario: "several variants and a location",
      query: (context: Awaited<ReturnType<typeof setup>>) => ({
        variantIds: `${context.mandarinsVariantId},${context.riceVariantId}`,
        locationIds: context.waterSevenId,
        reasons: "correction,sale",
      }),
      expected: ["correction", "sale"] as const,
    },
    {
      scenario: "employees",
      query: (context: Awaited<ReturnType<typeof setup>>) => ({ createdByIds: context.clerkId }),
      expected: ["theft", "damage"] as const,
    },
    {
      scenario: "an inclusive occurred date range",
      query: () => ({ from: at(2).toISOString(), to: at(4).toISOString() }),
      expected: ["damage", "riceOpening", "sale"] as const,
    },
  ])("filters by $scenario", async ({ query, expected }) => {
    const context = await setup();

    const result = await context
      .list(context.owner, query(context))
      .then((page) => page.value?.results.map((change) => change.id));

    expect(result).toEqual(expected.map((name) => context.movements[name].id));
  });

  it("pages one by one through movements recorded at the same sub-second instant without skipping any", async () => {
    const context = await setup();
    const [firstId, secondId] = [generateId({ model: "inventoryMovement" }), generateId({ model: "inventoryMovement" })]
      .sort()
      .reverse();
    const values = {
      merchantId: context.merchantId,
      inventoryLevelId: context.mandarinsAtWaterSevenId,
      fromState: "in_stock" as const,
      toState: "waste" as const,
      unitCost: "8.00",
      createdById: context.ownerId,
      occurredAt: at(9),
      createdAt: at(9),
      updatedAt: at(9),
    };
    await context.db.insert(tables.inventoryMovement).values([
      { ...values, id: firstId, reason: "lost", quantityDelta: -2 },
      { ...values, id: secondId, reason: "damaged", quantityDelta: -1 },
    ]);
    // An adjustment batch shares one timestamp, and the cursor must keep its full microsecond precision.
    await context.db
      .update(tables.inventoryMovement)
      .set({ occurredAt: sql`'2026-11-19 15:09:00.123456'` })
      .where(inArray(tables.inventoryMovement.id, [firstId, secondId]));
    await context.db
      .update(tables.inventoryLevel)
      .set({ onHand: 7 })
      .where(eq(tables.inventoryLevel.id, context.mandarinsAtWaterSevenId));

    const query = { variantIds: context.mandarinsVariantId, limit: 1 };
    const first = await context.list(context.owner, query);
    const second = await context.list(context.owner, { ...query, cursor: first.value!.nextCursor! });
    const third = await context.list(context.owner, { ...query, cursor: second.value!.nextCursor! });

    const summarize = (page: typeof first) =>
      page.value?.results.map((change) => [change.id, change.type === "movement" ? change.onHandAfter : null]);
    expect(summarize(first)).toEqual([[firstId, 7]]);
    expect(summarize(second)).toEqual([[secondId, 9]]);
    expect(summarize(third)).toEqual([[context.movements.transferIn.id, 5]]);
  });

  it("returns an empty final page when nothing matches", async () => {
    const context = await setup();

    const result = await context.list(context.owner, { reasons: "purchase" });

    expect(result.value).toEqual({ results: [], nextCursor: null, hasMore: false });
  });

  it("limits employees without owner access to the locations they can access", async () => {
    const context = await setup();

    const result = await context.list(context.auditor);

    expect(result.value?.results.map((change) => change.locationId)).toEqual(
      Array.from({ length: 6 }, () => context.waterSevenId),
    );
  });

  it("accepts locations the employee can access", async () => {
    const context = await setup();

    const result = await context.list(context.auditor, { locationIds: context.waterSevenId });

    expect(result.value?.results).toHaveLength(6);
  });

  it("rejects a requested location the employee cannot access instead of hiding it", async () => {
    const context = await setup();

    const result = await context.list(context.auditor, {
      locationIds: `${context.waterSevenId},${context.dressrosaId}`,
    });

    expect(result.error).toEqual({
      code: codes.forbiddenError,
      message: "You do not have access to one or more of the requested locations.",
      details: [],
    });
  });

  it("rejects employees without permission to view inventory reports", async () => {
    const context = await setup();

    const result = await context.list(context.clerk);

    expect(result.error).toEqual({
      code: codes.forbiddenError,
      message: "You do not have permission to view inventory history.",
      details: [],
    });
  });
});
