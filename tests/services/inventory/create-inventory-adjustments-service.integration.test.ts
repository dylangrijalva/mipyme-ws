import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import type { CurrentUser } from "../../../src/contracts/current-user.ts";
import type { Database } from "../../../src/db/index.ts";
import { tables } from "../../../src/db/schema.ts";
import { ProductFinder } from "../../../src/finders/product-finder.ts";
import { PurchaseFinder } from "../../../src/finders/purchase-finder.ts";
import { SaleFinder } from "../../../src/finders/sale-finder.ts";
import { EmployeeManagement } from "../../../src/services/employee-management.ts";
import {
  CreateInventoryAdjustmentsRequest,
  CreateInventoryAdjustmentsService,
} from "../../../src/services/inventory/create-inventory-adjustments-service.ts";
import { CreatePurchaseService } from "../../../src/services/purchases/create-purchase-service.ts";
import { VoidPurchaseService } from "../../../src/services/purchases/void-purchase-service.ts";
import { CreateSaleService } from "../../../src/services/sales/create-sale-service.ts";
import { VoidSaleService } from "../../../src/services/sales/void-sale-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import { createRealtimeEventPublisherMock } from "../../test-utils/realtime-publisher-mock.ts";
import { CollectionFinder } from "../../../src/finders/collection-finder.ts";
import { EmployeeAuthorizationService } from "../../../src/services/employee-authorization-service.ts";

const OPENED_AT = new Date("2026-11-01T14:00:00.000Z");
const ADJUSTED_AT = new Date("2026-11-19T16:30:00.000Z");

async function setup() {
  const clock = vi.spyOn(Date, "now").mockReturnValue(ADJUSTED_AT.getTime());
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  const ownerId = generateId({ model: "employee" });
  const clerkId = generateId({ model: "employee" });
  const cashierId = generateId({ model: "employee" });
  const foreignEmployeeId = generateId({ model: "employee" });
  const waterSevenId = generateId({ model: "location" });
  const dressrosaId = generateId({ model: "location" });
  const foreignLocationId = generateId({ model: "location" });
  const mandarinsId = generateId({ model: "product" });
  const riceId = generateId({ model: "product" });
  const popGreensId = generateId({ model: "product" });
  const navigationId = generateId({ model: "product" });
  const foreignProductId = generateId({ model: "product" });
  const mandarinsVariantId = generateId({ model: "variant" });
  const riceVariantId = generateId({ model: "variant" });
  const popGreensVariantId = generateId({ model: "variant" });
  const navigationVariantId = generateId({ model: "variant" });
  const foreignVariantId = generateId({ model: "variant" });
  const mandarinsLevelId = generateId({ model: "inventoryLevel" });
  const riceLevelId = generateId({ model: "inventoryLevel" });

  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  await db.insert(tables.employee).values([
    { id: ownerId, merchantId, name: "Monkey D. Luffy", isOwner: true, status: "enabled", pin: "0001" },
    { id: clerkId, merchantId, name: "Nico Robin", status: "enabled", pin: "2222", permissions: "manage_inventory" },
    { id: cashierId, merchantId, name: "Usopp", status: "enabled", pin: "3333", permissions: "checkout" },
    {
      id: foreignEmployeeId,
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
  await db.insert(tables.locationAccess).values([
    { id: generateId({ model: "locationAccess" }), merchantId, employeeId: clerkId, locationId: waterSevenId },
    { id: generateId({ model: "locationAccess" }), merchantId, employeeId: cashierId, locationId: waterSevenId },
  ]);
  await db.insert(tables.product).values([
    {
      id: mandarinsId,
      merchantId,
      name: "Nami's mandarins",
      slug: mandarinsId,
      price: "30.00",
      unitCost: "8.50",
      type: "item",
      status: "active",
      lastRestockAt: OPENED_AT,
      createdAt: OPENED_AT,
      updatedAt: OPENED_AT,
    },
    {
      id: riceId,
      merchantId,
      name: "Sanji's rice",
      slug: riceId,
      price: "12.00",
      unitCost: "5.25",
      type: "item",
      status: "draft",
      lastRestockAt: OPENED_AT,
      createdAt: OPENED_AT,
      updatedAt: OPENED_AT,
    },
    {
      id: popGreensId,
      merchantId,
      name: "Usopp's pop greens",
      slug: popGreensId,
      price: "3.00",
      unitCost: "1.00",
      type: "item",
      status: "draft",
      createdAt: OPENED_AT,
      updatedAt: OPENED_AT,
    },
    {
      id: navigationId,
      merchantId,
      name: "Nami's navigation",
      slug: navigationId,
      price: "50.00",
      unitCost: "0.00",
      type: "service",
      status: "active",
      createdAt: OPENED_AT,
      updatedAt: OPENED_AT,
    },
    {
      id: foreignProductId,
      merchantId: otherMerchantId,
      name: "Law's scalpels",
      slug: foreignProductId,
      price: "40.00",
      unitCost: "20.00",
      type: "item",
      status: "active",
    },
  ]);
  await db.insert(tables.variant).values([
    { id: mandarinsVariantId, merchantId, productId: mandarinsId, name: "Nami's mandarins", price: "30.00" },
    { id: riceVariantId, merchantId, productId: riceId, name: "Sanji's rice", price: "12.00" },
    { id: popGreensVariantId, merchantId, productId: popGreensId, name: "Usopp's pop greens", price: "3.00" },
    { id: navigationVariantId, merchantId, productId: navigationId, name: "Nami's navigation", price: "50.00" },
    {
      id: foreignVariantId,
      merchantId: otherMerchantId,
      productId: foreignProductId,
      name: "Law's scalpels",
      price: "40.00",
    },
  ]);
  const openedLevel = {
    merchantId,
    locationId: waterSevenId,
    lastRestockAt: OPENED_AT,
    lastInventoryAdjustmentAt: OPENED_AT,
    createdAt: OPENED_AT,
    updatedAt: OPENED_AT,
  };
  await db.insert(tables.inventoryLevel).values([
    { ...openedLevel, id: mandarinsLevelId, variantId: mandarinsVariantId, onHand: 10, lowStockThreshold: 3 },
    { ...openedLevel, id: riceLevelId, variantId: riceVariantId, onHand: 4 },
    {
      id: generateId({ model: "inventoryLevel" }),
      merchantId,
      locationId: waterSevenId,
      variantId: popGreensVariantId,
      onHand: 0,
      createdAt: OPENED_AT,
      updatedAt: OPENED_AT,
    },
  ]);
  const openingMovement = {
    merchantId,
    reason: "initial_stock" as const,
    fromState: "none" as const,
    toState: "in_stock" as const,
    createdById: ownerId,
    occurredAt: OPENED_AT,
    createdAt: OPENED_AT,
    updatedAt: OPENED_AT,
  };
  await db.insert(tables.inventoryMovement).values([
    {
      ...openingMovement,
      id: generateId({ model: "inventoryMovement" }),
      inventoryLevelId: mandarinsLevelId,
      quantityDelta: 10,
      unitCost: "8.00",
    },
    {
      ...openingMovement,
      id: generateId({ model: "inventoryMovement" }),
      inventoryLevelId: riceLevelId,
      quantityDelta: 4,
      unitCost: "5.00",
    },
  ]);

  const createUser = (employeeId: string, accountType: CurrentUser["accountType"]): CurrentUser => ({
    id: generateId({ model: "account" }),
    email: "crew@strawhatpirates.example.com",
    merchantId,
    employeeId,
    accountType,
  });
  const owner = createUser(ownerId, "owner");
  const clerk = createUser(clerkId, "staff");
  const cashier = createUser(cashierId, "staff");
  const { publisher, broadcast } = createRealtimeEventPublisherMock();
  const dependencies = (user: CurrentUser) => ({
    logger: pino({ enabled: false }),
    db,
    employeeAuthorizationService: EmployeeAuthorizationService.create({ db }),
    user,
    publisher,
    productFinder: new ProductFinder(new CollectionFinder()),
    employeeManagement: new EmployeeManagement(EmployeeAuthorizationService.create({ db })),
  });
  const createService = (user: CurrentUser = owner) => CreateInventoryAdjustmentsService.create(dependencies(user));

  return {
    db,
    clock,
    merchantId,
    ownerId,
    clerkId,
    cashierId,
    foreignEmployeeId,
    waterSevenId,
    dressrosaId,
    foreignLocationId,
    mandarinsId,
    riceId,
    mandarinsVariantId,
    riceVariantId,
    popGreensVariantId,
    navigationVariantId,
    foreignVariantId,
    mandarinsLevelId,
    riceLevelId,
    owner,
    clerk,
    cashier,
    broadcast,
    dependencies,
    createService,
  };
}

async function readState(db: Database) {
  return {
    products: await db.select().from(tables.product).orderBy(tables.product.id),
    levels: await db.select().from(tables.inventoryLevel).orderBy(tables.inventoryLevel.id),
    movements: await db.select().from(tables.inventoryMovement).orderBy(tables.inventoryMovement.id),
  };
}

async function readLevel(db: Database, id: string) {
  const [level] = await db.select().from(tables.inventoryLevel).where(eq(tables.inventoryLevel.id, id));
  return level;
}

async function sumOfDeltas(db: Database, inventoryLevelId: string) {
  const [total] = await db
    .select({ quantity: sql<number>`coalesce(sum(${tables.inventoryMovement.quantityDelta}), 0)`.mapWith(Number) })
    .from(tables.inventoryMovement)
    .where(eq(tables.inventoryMovement.inventoryLevelId, inventoryLevelId));
  return total.quantity;
}

async function countProductLockWaits(db: Database) {
  const [lockWaits] = await db
    .select({
      waiting: sql<number>`count(distinct performance_schema.data_lock_waits.REQUESTING_ENGINE_TRANSACTION_ID)`.mapWith(
        Number,
      ),
    })
    .from(sql`performance_schema.data_lock_waits`)
    .innerJoin(
      sql`performance_schema.data_locks`,
      sql`performance_schema.data_lock_waits.REQUESTING_ENGINE_LOCK_ID = performance_schema.data_locks.ENGINE_LOCK_ID`,
    ).where(sql`
      performance_schema.data_locks.OBJECT_SCHEMA = DATABASE()
      AND performance_schema.data_locks.OBJECT_NAME = 'products'
    `);
  return lockWaits.waiting;
}

describe("CreateInventoryAdjustmentsService", () => {
  afterEach(() => vi.restoreAllMocks());

  it("records each line at the product's current unit cost and publishes the adjusted products", async () => {
    const context = await setup();

    const result = await context.createService().execute(
      CreateInventoryAdjustmentsRequest.parse({
        locationId: context.waterSevenId,
        lineItems: [
          { variantId: context.mandarinsVariantId, reason: "damaged", quantityDelta: -3, notes: "  Water leak  " },
          { variantId: context.riceVariantId, reason: "correction", quantityDelta: 2, notes: "Miscounted the opening" },
        ],
      }),
    );

    expect(result).toEqual({
      success: true,
      value: {
        movements: [
          {
            id: expect.stringMatching(/^invm_/),
            variantId: context.mandarinsVariantId,
            locationId: context.waterSevenId,
            referenceId: null,
            notes: "Water leak",
            reason: "damaged",
            fromState: "in_stock",
            toState: "waste",
            quantityDelta: -3,
            unitCost: "8.50",
            createdBy: { id: context.ownerId, name: "Monkey D. Luffy" },
            occurredAt: ADJUSTED_AT,
            createdAt: ADJUSTED_AT,
            updatedAt: ADJUSTED_AT,
          },
          {
            id: expect.stringMatching(/^invm_/),
            variantId: context.riceVariantId,
            locationId: context.waterSevenId,
            referenceId: null,
            notes: "Miscounted the opening",
            reason: "correction",
            fromState: "none",
            toState: "in_stock",
            quantityDelta: 2,
            unitCost: "5.25",
            createdBy: { id: context.ownerId, name: "Monkey D. Luffy" },
            occurredAt: ADJUSTED_AT,
            createdAt: ADJUSTED_AT,
            updatedAt: ADJUSTED_AT,
          },
        ],
        inventoryLevels: [
          { variantId: context.mandarinsVariantId, id: context.mandarinsLevelId, onHand: 7 },
          { variantId: context.riceVariantId, id: context.riceLevelId, onHand: 6 },
        ]
          .sort((first, second) => (first.variantId < second.variantId ? -1 : 1))
          .map((level) => expect.objectContaining({ ...level, stockStatus: "in_stock" })),
      },
    });

    const state = await readState(context.db);
    const mandarins = state.products.find((product) => product.id === context.mandarinsId)!;
    const rice = state.products.find((product) => product.id === context.riceId)!;
    expect(mandarins).toMatchObject({ unitCost: "8.50", lastRestockAt: OPENED_AT, updatedAt: ADJUSTED_AT });
    expect(rice).toMatchObject({ unitCost: "5.25", lastRestockAt: OPENED_AT, updatedAt: ADJUSTED_AT });
    expect(await readLevel(context.db, context.mandarinsLevelId)).toMatchObject({
      onHand: 7,
      lastRestockAt: OPENED_AT,
      lastInventoryAdjustmentAt: ADJUSTED_AT,
      updatedAt: ADJUSTED_AT,
    });
    expect(await readLevel(context.db, context.riceLevelId)).toMatchObject({
      onHand: 6,
      lastRestockAt: ADJUSTED_AT,
      lastInventoryAdjustmentAt: ADJUSTED_AT,
    });
    const savedMovements = state.movements.filter(
      (movement) => movement.occurredAt.getTime() === ADJUSTED_AT.getTime(),
    );
    expect(savedMovements).toEqual(
      expect.arrayContaining(
        result.value!.movements.map((movement) =>
          expect.objectContaining({
            id: movement.id,
            notes: movement.notes,
            reason: movement.reason,
            fromState: movement.fromState,
            toState: movement.toState,
            quantityDelta: movement.quantityDelta,
            unitCost: movement.unitCost,
            createdById: context.ownerId,
          }),
        ),
      ),
    );
    expect(savedMovements).toHaveLength(2);
    expect(await sumOfDeltas(context.db, context.mandarinsLevelId)).toBe(7);
    expect(await sumOfDeltas(context.db, context.riceLevelId)).toBe(6);

    expect(context.broadcast).toHaveBeenCalledTimes(2);
    expect(context.broadcast.mock.calls.map(([event]) => event)).toEqual(
      expect.arrayContaining([
        {
          merchantId: context.merchantId,
          resource: {
            type: "product",
            snapshot: expect.objectContaining({
              id: context.mandarinsId,
              variants: [
                expect.objectContaining({
                  inventoryLevels: expect.arrayContaining([expect.objectContaining({ onHand: 7 })]),
                }),
              ],
            }),
          },
        },
        {
          merchantId: context.merchantId,
          resource: { type: "product", snapshot: expect.objectContaining({ id: context.riceId }) },
        },
      ]),
    );
  });

  it.each([
    { reason: "damaged" as const, quantityDelta: -2, notes: null, fromState: "in_stock", toState: "waste" },
    { reason: "theft" as const, quantityDelta: -2, notes: null, fromState: "in_stock", toState: "waste" },
    { reason: "lost" as const, quantityDelta: -2, notes: "Fell overboard", fromState: "in_stock", toState: "waste" },
    { reason: "correction" as const, quantityDelta: -2, notes: "Double scan", fromState: "in_stock", toState: "none" },
    { reason: "correction" as const, quantityDelta: 2, notes: "Found a crate", fromState: "none", toState: "in_stock" },
  ])("records $reason of $quantityDelta as $fromState to $toState", async (lineItem) => {
    const context = await setup();

    const result = await context.createService().execute({
      locationId: context.waterSevenId,
      lineItems: [
        {
          variantId: context.mandarinsVariantId,
          reason: lineItem.reason,
          quantityDelta: lineItem.quantityDelta,
          notes: lineItem.notes,
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.value?.movements[0]).toMatchObject({
      reason: lineItem.reason,
      fromState: lineItem.fromState,
      toState: lineItem.toState,
      quantityDelta: lineItem.quantityDelta,
      notes: lineItem.notes,
    });
    const [savedMovement] = await context.db
      .select()
      .from(tables.inventoryMovement)
      .where(eq(tables.inventoryMovement.id, result.value!.movements[0].id));
    expect(savedMovement).toMatchObject({ fromState: lineItem.fromState, toState: lineItem.toState });
    expect(await readLevel(context.db, context.mandarinsLevelId)).toMatchObject({
      onHand: 10 + lineItem.quantityDelta,
      lastRestockAt: lineItem.quantityDelta > 0 ? ADJUSTED_AT : OPENED_AT,
    });
  });

  it("moves the product's updatedAt forward even when it is not behind the clock", async () => {
    const context = await setup();
    await context.db
      .update(tables.product)
      .set({ updatedAt: ADJUSTED_AT })
      .where(eq(tables.product.id, context.mandarinsId));

    await context.createService().execute({
      locationId: context.waterSevenId,
      lineItems: [{ variantId: context.mandarinsVariantId, reason: "theft", quantityDelta: -1 }],
    });

    const [product] = await context.db.select().from(tables.product).where(eq(tables.product.id, context.mandarinsId));
    expect(product.updatedAt).toEqual(new Date(ADJUSTED_AT.getTime() + 1));
  });

  it("stores a blank note on a stock-reducing adjustment as null", async () => {
    const context = await setup();

    const result = await context.createService().execute({
      locationId: context.waterSevenId,
      lineItems: [{ variantId: context.mandarinsVariantId, reason: "theft", quantityDelta: -1, notes: "" }],
    });

    expect(result.value?.movements[0].notes).toBeNull();
    const [movement] = await context.db
      .select()
      .from(tables.inventoryMovement)
      .where(eq(tables.inventoryMovement.reason, "theft"));
    expect(movement.notes).toBeNull();
  });

  it("creates the level when a correction brings stock to a location that never held the variant", async () => {
    const context = await setup();

    const result = await context.createService().execute({
      locationId: context.dressrosaId,
      lineItems: [
        { variantId: context.mandarinsVariantId, reason: "correction", quantityDelta: 5, notes: "Moved from Water 7" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.value?.inventoryLevels).toEqual([
      expect.objectContaining({
        variantId: context.mandarinsVariantId,
        locationId: context.dressrosaId,
        onHand: 5,
        lowStockThreshold: 0,
        optimalStockLevel: 0,
        lastRestockAt: ADJUSTED_AT,
        lastInventoryAdjustmentAt: ADJUSTED_AT,
        stockStatus: "in_stock",
      }),
    ]);
    const createdLevelId = result.value!.inventoryLevels[0].id;
    expect(await readLevel(context.db, createdLevelId)).toMatchObject({ merchantId: context.merchantId, onHand: 5 });
    expect(await sumOfDeltas(context.db, createdLevelId)).toBe(5);
    expect(await readLevel(context.db, context.mandarinsLevelId)).toMatchObject({ onHand: 10, updatedAt: OPENED_AT });
  });

  it("rejects the whole batch when one line would take stock below zero", async () => {
    const context = await setup();
    const before = await readState(context.db);

    const result = await context.createService().execute({
      locationId: context.waterSevenId,
      lineItems: [
        { variantId: context.mandarinsVariantId, reason: "damaged", quantityDelta: -3 },
        { variantId: context.riceVariantId, reason: "lost", quantityDelta: -5 },
      ],
    });

    expect(result).toEqual({
      success: false,
      error: {
        code: codes.stockInsufficient,
        message: "One or more adjustments would reduce stock below zero at this location.",
        details: [
          {
            code: codes.stockInsufficient,
            message: `Variant ${context.riceVariantId} is short by 1.`,
            field: "lineItems.1.quantityDelta",
          },
        ],
      },
    });
    expect(await readState(context.db)).toEqual(before);
    expect(context.broadcast).not.toHaveBeenCalled();
  });

  it("allows a decrease that empties the level", async () => {
    const context = await setup();

    const result = await context.createService().execute({
      locationId: context.waterSevenId,
      lineItems: [{ variantId: context.riceVariantId, reason: "lost", quantityDelta: -4 }],
    });

    expect(result.value?.inventoryLevels).toEqual([
      expect.objectContaining({ onHand: 0, stockStatus: "out_of_stock" }),
    ]);
  });

  it("rejects a decrease at a location without a level and does not create one", async () => {
    const context = await setup();
    const before = await readState(context.db);

    const result = await context.createService().execute({
      locationId: context.dressrosaId,
      lineItems: [{ variantId: context.mandarinsVariantId, reason: "damaged", quantityDelta: -1 }],
    });

    expect(result.error).toMatchObject({
      code: codes.stockInsufficient,
      details: [expect.objectContaining({ message: `Variant ${context.mandarinsVariantId} is short by 1.` })],
    });
    expect(await readState(context.db)).toEqual(before);
  });

  it("rejects stock-reducing reasons that add stock and corrections without notes, reporting every line", async () => {
    const context = await setup();
    const before = await readState(context.db);

    const result = await context.createService().execute({
      locationId: context.waterSevenId,
      lineItems: [
        { variantId: context.mandarinsVariantId, reason: "theft", quantityDelta: 2, notes: "Returned by the thief" },
        { variantId: context.riceVariantId, reason: "correction", quantityDelta: -1, notes: "" },
      ],
    });

    expect(result).toEqual({
      success: false,
      error: {
        code: codes.validationError,
        message: "One or more inventory adjustments are invalid.",
        details: [
          {
            code: codes.validationError,
            message: "Damaged, theft, and lost adjustments must reduce stock.",
            field: "lineItems.0.quantityDelta",
          },
          {
            code: codes.validationError,
            message: "Explain why the stock is being corrected.",
            field: "lineItems.1.notes",
          },
        ],
      },
    });
    expect(await readState(context.db)).toEqual(before);
  });

  it("rejects a variant that appears more than once", async () => {
    const context = await setup();
    const before = await readState(context.db);

    const result = await context.createService().execute({
      locationId: context.waterSevenId,
      lineItems: [
        { variantId: context.mandarinsVariantId, reason: "damaged", quantityDelta: -1 },
        { variantId: context.mandarinsVariantId, reason: "theft", quantityDelta: -1 },
      ],
    });

    expect(result.error).toEqual({
      code: codes.validationError,
      message: "Each variant can only appear once in an inventory adjustment.",
      details: [],
    });
    expect(await readState(context.db)).toEqual(before);
  });

  it("rejects a product whose opening stock was never set", async () => {
    const context = await setup();
    const before = await readState(context.db);

    const result = await context.createService().execute({
      locationId: context.waterSevenId,
      lineItems: [
        { variantId: context.mandarinsVariantId, reason: "damaged", quantityDelta: -1 },
        { variantId: context.popGreensVariantId, reason: "correction", quantityDelta: 4, notes: "Found a box" },
      ],
    });

    expect(result.error).toEqual({
      code: codes.validationError,
      message: "Set the product's opening stock before adjusting its inventory.",
      details: [
        { code: codes.validationError, message: `Variant ${context.popGreensVariantId} has no opening stock.` },
      ],
    });
    expect(await readState(context.db)).toEqual(before);
  });

  it("rejects service products", async () => {
    const context = await setup();
    const before = await readState(context.db);

    const result = await context.createService().execute({
      locationId: context.waterSevenId,
      lineItems: [{ variantId: context.navigationVariantId, reason: "correction", quantityDelta: 1, notes: "Typo" }],
    });

    expect(result.error).toMatchObject({
      code: codes.validationError,
      message: "Inventory adjustments can only contain item products.",
    });
    expect(await readState(context.db)).toEqual(before);
  });

  it.each([
    { scenario: "another merchant's variant", archived: null },
    { scenario: "an archived variant", archived: "variant" as const },
    { scenario: "a variant of an archived product", archived: "product" as const },
  ])("rejects $scenario as not found", async ({ archived }) => {
    const context = await setup();
    if (archived === "variant") {
      await context.db
        .update(tables.variant)
        .set({ archivedAt: OPENED_AT })
        .where(eq(tables.variant.id, context.mandarinsVariantId));
    }
    if (archived === "product") {
      await context.db
        .update(tables.product)
        .set({ archivedAt: OPENED_AT })
        .where(eq(tables.product.id, context.mandarinsId));
    }
    const before = await readState(context.db);

    const result = await context.createService().execute({
      locationId: context.waterSevenId,
      lineItems: [
        {
          variantId: archived === null ? context.foreignVariantId : context.mandarinsVariantId,
          reason: "damaged",
          quantityDelta: -1,
        },
      ],
    });

    expect(result.error).toEqual({
      code: codes.resourceNotFound,
      message: "One or more variants have not been found.",
      details: [],
    });
    expect(await readState(context.db)).toEqual(before);
  });

  it("lets an employee with inventory permission adjust a location they can access", async () => {
    const context = await setup();

    const result = await context.createService(context.clerk).execute({
      locationId: context.waterSevenId,
      lineItems: [{ variantId: context.mandarinsVariantId, reason: "theft", quantityDelta: -1 }],
    });

    expect(result.value?.movements[0].createdBy).toEqual({ id: context.clerkId, name: "Nico Robin" });
  });

  it("credits the requested employee and checks their permission instead of the signed-in owner's", async () => {
    const context = await setup();

    const deniedResult = await context.createService(context.owner).execute({
      locationId: context.waterSevenId,
      createdById: context.cashierId,
      lineItems: [{ variantId: context.mandarinsVariantId, reason: "theft", quantityDelta: -1 }],
    });
    const creditedResult = await context.createService(context.owner).execute({
      locationId: context.waterSevenId,
      createdById: context.clerkId,
      lineItems: [{ variantId: context.mandarinsVariantId, reason: "theft", quantityDelta: -1 }],
    });

    expect(deniedResult.error).toEqual({
      code: codes.forbiddenError,
      message: "The employee does not have permission to adjust inventory.",
      details: [],
    });
    expect(creditedResult.value?.movements[0].createdBy).toEqual({ id: context.clerkId, name: "Nico Robin" });
    const movements = await context.db
      .select()
      .from(tables.inventoryMovement)
      .where(eq(tables.inventoryMovement.reason, "theft"));
    expect(movements).toEqual([expect.objectContaining({ createdById: context.clerkId, quantityDelta: -1 })]);
    expect(await readLevel(context.db, context.mandarinsLevelId)).toMatchObject({ onHand: 9 });
  });

  it("checks location access for the credited employee instead of the signed-in owner", async () => {
    const context = await setup();
    const before = await readState(context.db);

    const result = await context.createService(context.owner).execute({
      locationId: context.dressrosaId,
      createdById: context.clerkId,
      lineItems: [{ variantId: context.mandarinsVariantId, reason: "correction", quantityDelta: 1, notes: "Recount" }],
    });

    expect(result.error).toEqual({
      code: codes.forbiddenError,
      message: "The employee does not have access to this location.",
      details: [],
    });
    expect(await readState(context.db)).toEqual(before);
  });

  it("accepts an adjustment credited to an authorized employee from an account without inventory permission", async () => {
    const context = await setup();

    const result = await context.createService(context.cashier).execute({
      locationId: context.waterSevenId,
      createdById: context.clerkId,
      lineItems: [{ variantId: context.mandarinsVariantId, reason: "theft", quantityDelta: -1 }],
    });

    expect(result.value?.movements[0].createdBy).toEqual({ id: context.clerkId, name: "Nico Robin" });
    expect(await readLevel(context.db, context.mandarinsLevelId)).toMatchObject({ onHand: 9 });
  });

  it("rejects an employee without inventory permission", async () => {
    const context = await setup();
    const before = await readState(context.db);

    const result = await context.createService(context.cashier).execute({
      locationId: context.waterSevenId,
      lineItems: [{ variantId: context.mandarinsVariantId, reason: "theft", quantityDelta: -1 }],
    });

    expect(result.error?.code).toBe(codes.forbiddenError);
    expect(await readState(context.db)).toEqual(before);
  });

  it("rejects a location the employee cannot access", async () => {
    const context = await setup();
    const before = await readState(context.db);

    const result = await context.createService(context.clerk).execute({
      locationId: context.dressrosaId,
      lineItems: [{ variantId: context.mandarinsVariantId, reason: "correction", quantityDelta: 1, notes: "Recount" }],
    });

    expect(result.error).toEqual({
      code: codes.forbiddenError,
      message: "The employee does not have access to this location.",
      details: [],
    });
    expect(await readState(context.db)).toEqual(before);
  });

  it.each([
    { scenario: "an unknown location", field: "location" as const },
    { scenario: "another merchant's location", field: "foreignLocation" as const },
    { scenario: "an unknown credited employee", field: "employee" as const },
    { scenario: "another merchant's employee", field: "foreignEmployee" as const },
  ])("rejects $scenario as not found", async ({ field }) => {
    const context = await setup();
    const before = await readState(context.db);
    const locationIds = {
      location: generateId({ model: "location" }),
      foreignLocation: context.foreignLocationId,
      employee: context.waterSevenId,
      foreignEmployee: context.waterSevenId,
    };
    const createdByIds = {
      location: undefined,
      foreignLocation: undefined,
      employee: generateId({ model: "employee" }),
      foreignEmployee: context.foreignEmployeeId,
    };

    const result = await context.createService().execute({
      locationId: locationIds[field],
      createdById: createdByIds[field],
      lineItems: [{ variantId: context.mandarinsVariantId, reason: "theft", quantityDelta: -1 }],
    });

    expect(result.error?.code).toBe(codes.resourceNotFound);
    expect(await readState(context.db)).toEqual(before);
  });

  it("rejects a disabled credited employee", async () => {
    const context = await setup();
    await context.db.update(tables.employee).set({ status: "disabled" }).where(eq(tables.employee.id, context.clerkId));
    const before = await readState(context.db);

    const result = await context.createService().execute({
      locationId: context.waterSevenId,
      createdById: context.clerkId,
      lineItems: [{ variantId: context.mandarinsVariantId, reason: "theft", quantityDelta: -1 }],
    });

    expect(result.error?.code).toBe(codes.forbiddenError);
    expect(await readState(context.db)).toEqual(before);
  });

  it("never lets concurrent adjustments take stock below zero", async () => {
    const context = await setup();
    const request = {
      locationId: context.waterSevenId,
      lineItems: [{ variantId: context.mandarinsVariantId, reason: "damaged" as const, quantityDelta: -6 }],
    };

    const { attempts } = await context.db.transaction(async (lock) => {
      await lock.select().from(tables.product).where(eq(tables.product.id, context.mandarinsId)).for("update");
      const attempts = Promise.all([
        context.createService().execute(request),
        context.createService().execute(request),
      ]);
      await expect.poll(() => countProductLockWaits(context.db), { timeout: 2_000 }).toBe(2);
      return { attempts };
    });
    const results = await attempts;

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)).toEqual([
      { success: false, error: expect.objectContaining({ code: codes.stockInsufficient }) },
    ]);
    expect(await readLevel(context.db, context.mandarinsLevelId)).toMatchObject({ onHand: 4 });
    expect(await sumOfDeltas(context.db, context.mandarinsLevelId)).toBe(4);
  });

  describe("interaction with voids", () => {
    it("blocks voiding an earlier purchase of an adjusted product", async () => {
      const context = await setup();
      const purchaseDependencies = {
        ...context.dependencies(context.owner),
        purchaseFinder: new PurchaseFinder(),
      };
      const supplierId = generateId({ model: "supplier" });
      await context.db
        .insert(tables.supplier)
        .values({ id: supplierId, merchantId: context.merchantId, name: "Baratie" });
      context.clock.mockReturnValue(new Date("2026-11-19T15:00:00.000Z").getTime());
      const purchase = await CreatePurchaseService.create(purchaseDependencies).execute({
        supplierId,
        locationId: context.waterSevenId,
        lineItems: [{ variantId: context.mandarinsVariantId, quantity: 2, unitCost: "8.00" }],
      });
      context.clock.mockReturnValue(ADJUSTED_AT.getTime());
      await context.createService().execute({
        locationId: context.waterSevenId,
        lineItems: [{ variantId: context.mandarinsVariantId, reason: "damaged", quantityDelta: -1 }],
      });

      const voided = await VoidPurchaseService.create(purchaseDependencies).execute(purchase.value!.id);

      expect(voided.error).toMatchObject({
        code: codes.validationError,
        message: "This purchase cannot be voided because a product's inventory changed after the purchase.",
      });
      expect(await readLevel(context.db, context.mandarinsLevelId)).toMatchObject({ onHand: 11 });
    });

    it("still allows voiding an earlier sale after a positive correction", async () => {
      const context = await setup();
      const saleDependencies = { ...context.dependencies(context.owner), saleFinder: new SaleFinder() };
      context.clock.mockReturnValue(new Date("2026-11-19T15:00:00.000Z").getTime());
      const sale = await CreateSaleService.create(saleDependencies).execute({
        source: "pos.web",
        locationId: context.waterSevenId,
        businessDate: new Date("2026-11-19T15:00:00.000Z"),
        lineItems: [{ variantId: context.mandarinsVariantId, quantity: 2, price: "30.00" }],
        payments: [{ method: "cash", amount: "60.00" }],
      });
      context.clock.mockReturnValue(ADJUSTED_AT.getTime());
      await context.createService().execute({
        locationId: context.waterSevenId,
        lineItems: [
          { variantId: context.mandarinsVariantId, reason: "correction", quantityDelta: 3, notes: "Recount" },
        ],
      });
      context.clock.mockReturnValue(new Date("2026-11-19T17:00:00.000Z").getTime());

      const voided = await VoidSaleService.create(saleDependencies).execute(sale.value!.id);

      expect(voided.success).toBe(true);
      expect(await readLevel(context.db, context.mandarinsLevelId)).toMatchObject({ onHand: 13 });
      expect(await sumOfDeltas(context.db, context.mandarinsLevelId)).toBe(13);
    });
  });
});
