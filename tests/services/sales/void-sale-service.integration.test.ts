import { and, eq } from "drizzle-orm";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import type { CurrentUser } from "../../../src/contracts/current-user.ts";
import type { Database } from "../../../src/db/index.ts";
import { tables } from "../../../src/db/schema.ts";
import { PurchaseFinder } from "../../../src/finders/purchase-finder.ts";
import { SaleFinder } from "../../../src/finders/sale-finder.ts";
import {
  CreatePurchaseRequest,
  CreatePurchaseService,
} from "../../../src/services/purchases/create-purchase-service.ts";
import { CreateSaleRequest, CreateSaleService } from "../../../src/services/sales/create-sale-service.ts";
import { VoidSaleRequest, VoidSaleService } from "../../../src/services/sales/void-sale-service.ts";
import { EmployeeManagement } from "../../../src/services/employee-management.ts";
import { ConcurrentUpdateError } from "../../../src/utils/concurrent-update-error.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import {
  createRealtimeEventPublisherMock,
  trackCommittedBroadcasts,
} from "../../test-utils/realtime-publisher-mock.ts";
import { EmployeeAuthorizationService } from "../../../src/services/employee-authorization-service.ts";

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const employeeId = generateId({ model: "employee" });
  const supplierId = generateId({ model: "supplier" });
  const locationId = generateId({ model: "location" });
  const otherLocationId = generateId({ model: "location" });
  const productId = generateId({ model: "product" });
  const variantId = generateId({ model: "variant" });
  const siblingVariantId = generateId({ model: "variant" });
  const serviceProductId = generateId({ model: "product" });
  const serviceVariantId = generateId({ model: "variant" });

  await db.insert(tables.merchant).values({ id: merchantId, name: "Straw Hat Pirates", country: "ni" });
  await db.insert(tables.employee).values({
    id: employeeId,
    merchantId,
    name: "Nami",
    isOwner: true,
    status: "enabled",
    pin: "4821",
  });
  await db.insert(tables.supplier).values({ id: supplierId, merchantId, name: "Baratie" });
  await db.insert(tables.location).values([
    { id: locationId, merchantId, name: "Water 7", nextSaleNumber: 42 },
    { id: otherLocationId, merchantId, name: "Dressrosa" },
  ]);
  await db.insert(tables.product).values([
    {
      id: productId,
      merchantId,
      name: "East Blue mandarins",
      slug: "east-blue-mandarins",
      price: "100.00",
      unitCost: "50.00",
      status: "active",
      type: "item",
    },
    {
      id: serviceProductId,
      merchantId,
      name: "Chopper's consultation",
      slug: "choppers-consultation",
      price: "20.00",
      unitCost: "0.00",
      status: "active",
      type: "service",
    },
  ]);
  await db.insert(tables.variant).values([
    { id: variantId, merchantId, productId, name: "Nami's crate", price: "100.00" },
    { id: siblingVariantId, merchantId, productId, name: "Nami's basket", price: "75.00" },
    { id: serviceVariantId, merchantId, productId: serviceProductId, name: "Chopper's visit", price: "20.00" },
  ]);
  await db.insert(tables.inventoryLevel).values([
    {
      id: generateId({ model: "inventoryLevel" }),
      merchantId,
      locationId,
      variantId,
      onHand: 5,
    },
    {
      id: generateId({ model: "inventoryLevel" }),
      merchantId,
      locationId: otherLocationId,
      variantId: siblingVariantId,
      onHand: 7,
    },
  ]);

  const user: CurrentUser = {
    id: employeeId,
    employeeId,
    merchantId,
    email: "nami@strawhatpirates.example.com",
    accountType: "owner",
  };
  const logger = pino({ enabled: false });
  const saleService = CreateSaleService.create({
    employeeManagement: new EmployeeManagement(EmployeeAuthorizationService.create({ db })),
    publisher: createRealtimeEventPublisherMock().publisher,
    db,
    employeeAuthorizationService: EmployeeAuthorizationService.create({ db }),
    user,
    logger,
    saleFinder: new SaleFinder(),
  });
  const purchaseService = CreatePurchaseService.create({
    employeeManagement: new EmployeeManagement(EmployeeAuthorizationService.create({ db })),
    publisher: createRealtimeEventPublisherMock().publisher,
    db,
    user,
    logger,
    purchaseFinder: new PurchaseFinder(),
  });
  const { broadcast, publisher } = createRealtimeEventPublisherMock();
  const voidService = VoidSaleService.create({
    employeeManagement: new EmployeeManagement(EmployeeAuthorizationService.create({ db })),
    publisher,
    db,
    user,
    logger,
    saleFinder: new SaleFinder(),
  });
  const saleRequest: CreateSaleRequest = {
    locationId,
    source: "pos.web",
    businessDate: new Date("2026-10-10T18:30:00.000Z"),
    lineItems: [{ variantId, price: "100.00", quantity: 2 }],
    payments: [{ method: "cash", amount: "200.00" }],
  };

  return {
    broadcast,
    db,
    employeeId,
    locationId,
    merchantId,
    otherLocationId,
    productId,
    purchaseService,
    saleRequest,
    saleService,
    serviceVariantId,
    siblingVariantId,
    supplierId,
    variantId,
    voidService,
    user,
  };
}

async function createSale(context: Awaited<ReturnType<typeof setup>>, request = context.saleRequest) {
  const result = await context.saleService.execute(request);
  if (!result.success) {
    throw new Error(`Sale creation failed: ${result.error.message}`);
  }

  return result.value;
}

function createVoidService(context: Awaited<ReturnType<typeof setup>>, user = context.user) {
  return VoidSaleService.create({
    employeeManagement: new EmployeeManagement(EmployeeAuthorizationService.create({ db: context.db })),
    publisher: createRealtimeEventPublisherMock().publisher,
    db: context.db,
    user,
    logger: pino({ enabled: false }),
    saleFinder: new SaleFinder(),
  });
}

async function readState(db: Database, merchantId: string) {
  return {
    inventoryLevels: await db
      .select()
      .from(tables.inventoryLevel)
      .where(eq(tables.inventoryLevel.merchantId, merchantId))
      .orderBy(tables.inventoryLevel.id),
    inventoryMovements: await db
      .select()
      .from(tables.inventoryMovement)
      .where(eq(tables.inventoryMovement.merchantId, merchantId))
      .orderBy(tables.inventoryMovement.id),
    products: await db
      .select()
      .from(tables.product)
      .where(eq(tables.product.merchantId, merchantId))
      .orderBy(tables.product.id),
    saleItems: await db
      .select()
      .from(tables.saleItem)
      .where(eq(tables.saleItem.merchantId, merchantId))
      .orderBy(tables.saleItem.id),
    salePayments: await db
      .select()
      .from(tables.salePayment)
      .where(eq(tables.salePayment.merchantId, merchantId))
      .orderBy(tables.salePayment.id),
    sales: await db.select().from(tables.sale).where(eq(tables.sale.merchantId, merchantId)).orderBy(tables.sale.id),
  };
}

describe("VoidSaleService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores physical quantities at the sale location and preserves sale history and cost", async () => {
    const context = await setup();
    const sale = await createSale(context, {
      ...context.saleRequest,
      lineItems: [
        ...context.saleRequest.lineItems,
        { variantId: context.serviceVariantId, price: "20.00", quantity: 1 },
      ],
      payments: [{ method: "cash", amount: "220.00" }],
    });
    const before = await readState(context.db, context.merchantId);
    const archivedAt = new Date("2026-10-12T00:00:00.000Z");

    await context.db
      .update(tables.product)
      .set({ unitCost: "60.00", archivedAt })
      .where(eq(tables.product.id, context.productId));
    await context.db.update(tables.variant).set({ archivedAt }).where(eq(tables.variant.id, context.variantId));

    const committedAtPublish = trackCommittedBroadcasts(context.db, context.broadcast);

    const result = await context.voidService.execute(
      sale.id,
      VoidSaleRequest.parse({ reason: "  Damaged during the crossing  " }),
    );

    expect(context.broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId: context.merchantId,
      resource: { type: "sale", snapshot: result.value },
    });
    expect(committedAtPublish).toEqual([true]);

    expect(result).toMatchObject({
      success: true,
      value: {
        status: "voided",
        voidReason: "Damaged during the crossing",
        voidedBy: { id: context.employeeId, name: "Nami" },
      },
    });
    if (!result.success) {
      return;
    }
    expect(result.value.voidedAt).toBeInstanceOf(Date);
    expect(result.value.payments).toEqual(sale.payments);

    const after = await readState(context.db, context.merchantId);
    expect(after.salePayments).toEqual(before.salePayments);
    expect(after.saleItems).toEqual(before.saleItems);
    const saleLevel = before.inventoryLevels.find((level) => level.locationId === context.locationId)!;
    expect(after.inventoryLevels.find((level) => level.locationId === context.locationId)).toMatchObject({
      onHand: 5,
      lastSoldAt: sale.createdAt,
      lastRestockAt: saleLevel.lastRestockAt,
      lastInventoryAdjustmentAt: result.value.voidedAt,
    });
    expect(after.inventoryLevels.find((level) => level.locationId === context.otherLocationId)).toEqual(
      before.inventoryLevels.find((level) => level.locationId === context.otherLocationId),
    );
    expect(after.products.find((product) => product.id === context.productId)).toMatchObject({
      unitCost: "60.00",
      archivedAt,
    });
    expect(after.inventoryMovements).toHaveLength(2);
    expect(after.inventoryMovements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "sale_void",
          fromState: "sold",
          toState: "in_stock",
          quantityDelta: 2,
          unitCost: "50.00",
          referenceId: sale.id,
          inventoryLevelId: before.inventoryMovements.find((movement) => movement.reason === "sale")?.inventoryLevelId,
          createdById: context.employeeId,
        }),
      ]),
    );
  });

  it("serializes concurrent void requests and preserves the first void metadata", async () => {
    const context = await setup();
    const sale = await createSale(context);
    const request = VoidSaleRequest.parse({ reason: "Original reason" });

    const concurrentResults = await Promise.all([
      context.voidService.execute(sale.id, request),
      context.voidService.execute(sale.id, request),
    ]);
    expect(concurrentResults.every((result) => result.success)).toBe(true);

    const beforeRepeat = await readState(context.db, context.merchantId);
    const repeatedResult = await context.voidService.execute(
      sale.id,
      VoidSaleRequest.parse({ reason: "Replacement reason" }),
    );
    expect(repeatedResult).toMatchObject({
      success: true,
      value: { status: "voided", voidReason: "Original reason", voidedBy: { id: context.employeeId } },
    });

    const state = await readState(context.db, context.merchantId);
    expect(state).toEqual(beforeRepeat);
    expect(state.inventoryLevels.find((level) => level.locationId === context.locationId)?.onHand).toBe(5);
    expect(state.inventoryMovements.filter((movement) => movement.reason === "sale_void")).toHaveLength(1);
    expect(state.sales[0]).toMatchObject({ status: "voided", voidReason: "Original reason" });
  });

  it("blocks a same-cost purchase of a sibling variant at another location, including an equal timestamp", async () => {
    const context = await setup();
    const sale = await createSale(context);
    await context.db
      .update(tables.sale)
      .set({ createdAt: new Date("2020-01-01T00:00:00.000Z") })
      .where(and(eq(tables.sale.id, sale.id), eq(tables.sale.merchantId, context.merchantId)));

    const purchaseResult = await context.purchaseService.execute(
      CreatePurchaseRequest.parse({
        supplierId: context.supplierId,
        locationId: context.otherLocationId,
        lineItems: [{ variantId: context.siblingVariantId, quantity: 1, unitCost: "50.00" }],
      }),
    );
    expect(purchaseResult.success).toBe(true);

    const [product] = await context.db
      .select({ unitCost: tables.product.unitCost, lastRestockAt: tables.product.lastRestockAt })
      .from(tables.product)
      .where(eq(tables.product.id, context.productId));
    expect(product).toMatchObject({ unitCost: "50.00" });
    expect(product?.lastRestockAt).toBeInstanceOf(Date);
    const stateAfterPurchase = await readState(context.db, context.merchantId);

    const laterPurchaseResult = await context.voidService.execute(sale.id, VoidSaleRequest.parse({}));
    expect(laterPurchaseResult).toMatchObject({ success: false, error: { code: codes.validationError } });
    expect(await readState(context.db, context.merchantId)).toEqual(stateAfterPurchase);

    await context.db
      .update(tables.sale)
      .set({ createdAt: product!.lastRestockAt! })
      .where(and(eq(tables.sale.id, sale.id), eq(tables.sale.merchantId, context.merchantId)));
    const stateAtEqualTimestamp = await readState(context.db, context.merchantId);
    const equalTimestampResult = await context.voidService.execute(sale.id, VoidSaleRequest.parse({}));

    expect(equalTimestampResult).toMatchObject({ success: false, error: { code: codes.validationError } });
    expect(await readState(context.db, context.merchantId)).toEqual(stateAtEqualTimestamp);
  });

  it("voids a fulfilled service-only sale without touching inventory", async () => {
    const context = await setup();
    const sale = await createSale(context, {
      ...context.saleRequest,
      lineItems: [{ variantId: context.serviceVariantId, price: "20.00", quantity: 2 }],
      payments: [{ method: "cash", amount: "40.00" }],
    });
    const before = await readState(context.db, context.merchantId);

    const result = await context.voidService.execute(sale.id, VoidSaleRequest.parse({ reason: "  \t " }));

    expect(result).toMatchObject({ success: true, value: { status: "voided", voidReason: null } });
    const after = await readState(context.db, context.merchantId);
    expect(after.inventoryLevels).toEqual(before.inventoryLevels);
    expect(after.inventoryMovements).toEqual(before.inventoryMovements);
    expect(after.salePayments).toEqual(before.salePayments);
  });

  it("rejects pending sales without changing their inventory or history", async () => {
    const context = await setup();
    const sale = await createSale(context, {
      ...context.saleRequest,
      source: "pos.android",
      lineItems: [{ variantId: context.variantId, price: "100.00", quantity: 6 }],
      payments: [{ method: "cash", amount: "600.00" }],
    });
    const before = await readState(context.db, context.merchantId);

    const result = await context.voidService.execute(sale.id, VoidSaleRequest.parse({}));

    expect(result).toMatchObject({ success: false, error: { code: codes.validationError } });
    expect(await readState(context.db, context.merchantId)).toEqual(before);
  });

  it("allows enabled staff with void_transaction permission and access to the sale location", async () => {
    const context = await setup();
    const sale = await createSale(context);
    const employeeId = generateId({ model: "employee" });
    await context.db.insert(tables.employee).values({
      id: employeeId,
      merchantId: context.merchantId,
      name: "Nico Robin",
      isOwner: false,
      status: "enabled",
      pin: "3333",
      permissions: "void_transaction",
    });
    await context.db.insert(tables.locationAccess).values({
      id: generateId({ model: "locationAccess" }),
      merchantId: context.merchantId,
      employeeId,
      locationId: context.locationId,
    });
    const staffUser: CurrentUser = {
      id: employeeId,
      employeeId,
      merchantId: context.merchantId,
      email: "nico.robin@strawhatpirates.example.com",
      accountType: "staff",
    };

    const result = await createVoidService(context, staffUser).execute(sale.id, VoidSaleRequest.parse({}));

    expect(result).toMatchObject({ success: true, value: { voidedBy: { id: employeeId, name: "Nico Robin" } } });
  });

  it.each([
    { name: "without void_transaction permission", permissions: "checkout", status: "enabled", accessLocation: true },
    { name: "without the sale location", permissions: "void_transaction", status: "enabled", accessLocation: false },
    { name: "when disabled", permissions: "void_transaction", status: "disabled", accessLocation: true },
  ] as const)("denies staff $name", async ({ permissions, status, accessLocation }) => {
    const context = await setup();
    const sale = await createSale(context);
    const employeeId = generateId({ model: "employee" });
    await context.db.insert(tables.employee).values({
      id: employeeId,
      merchantId: context.merchantId,
      name: "Sanji",
      isOwner: false,
      status,
      pin: "2222",
      permissions,
    });
    await context.db.insert(tables.locationAccess).values({
      id: generateId({ model: "locationAccess" }),
      merchantId: context.merchantId,
      employeeId,
      locationId: accessLocation ? context.locationId : context.otherLocationId,
    });
    const staffUser: CurrentUser = {
      id: employeeId,
      employeeId,
      merchantId: context.merchantId,
      email: "sanji@strawhatpirates.example.com",
      accountType: "staff",
    };
    const before = await readState(context.db, context.merchantId);

    const result = await createVoidService(context, staffUser).execute(sale.id, VoidSaleRequest.parse({}));

    expect(result).toMatchObject({ success: false, error: { code: codes.forbiddenError } });
    expect(await readState(context.db, context.merchantId)).toEqual(before);
  });

  it("does not find a sale through a different merchant", async () => {
    const context = await setup();
    const sale = await createSale(context);
    const foreignMerchantId = generateId({ model: "merchant" });
    const foreignEmployeeId = generateId({ model: "employee" });
    await context.db.insert(tables.merchant).values({ id: foreignMerchantId, name: "Heart Pirates", country: "ni" });
    await context.db.insert(tables.employee).values({
      id: foreignEmployeeId,
      merchantId: foreignMerchantId,
      name: "Trafalgar Law",
      isOwner: true,
      status: "enabled",
      pin: "4821",
    });
    const foreignUser: CurrentUser = {
      id: foreignEmployeeId,
      employeeId: foreignEmployeeId,
      merchantId: foreignMerchantId,
      email: "law@heartpirates.example.com",
      accountType: "owner",
    };
    const before = await readState(context.db, context.merchantId);

    const result = await createVoidService(context, foreignUser).execute(sale.id, VoidSaleRequest.parse({}));

    expect(result).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    expect(await readState(context.db, context.merchantId)).toEqual(before);
  });

  it("rolls back a failed attempt and retries without restoring stock twice", async () => {
    const context = await setup();
    const sale = await createSale(context);
    const saleFinder = new SaleFinder();
    vi.spyOn(saleFinder, "find").mockRejectedValueOnce(new ConcurrentUpdateError());
    const service = VoidSaleService.create({
      employeeManagement: new EmployeeManagement(EmployeeAuthorizationService.create({ db: context.db })),
      publisher: createRealtimeEventPublisherMock().publisher,
      db: context.db,
      user: context.user,
      logger: pino({ enabled: false }),
      saleFinder,
    });
    const before = await readState(context.db, context.merchantId);

    const result = await service.execute(sale.id, { reason: "Retry after conflict" });

    expect(result).toMatchObject({ success: true, value: { status: "voided", voidReason: "Retry after conflict" } });
    const after = await readState(context.db, context.merchantId);
    expect(after.inventoryLevels.find((level) => level.locationId === context.locationId)?.onHand).toBe(5);
    expect(after.inventoryMovements.filter((movement) => movement.reason === "sale_void")).toHaveLength(1);
    expect(after.saleItems).toEqual(before.saleItems);
    expect(after.salePayments).toEqual(before.salePayments);
  });

  it("returns a conflict after exhausted retries and rolls back every void effect", async () => {
    const context = await setup();
    const sale = await createSale(context);
    const saleFinder = new SaleFinder();
    vi.spyOn(saleFinder, "find").mockRejectedValue(new ConcurrentUpdateError());
    const service = VoidSaleService.create({
      employeeManagement: new EmployeeManagement(EmployeeAuthorizationService.create({ db: context.db })),
      publisher: createRealtimeEventPublisherMock().publisher,
      db: context.db,
      user: context.user,
      logger: pino({ enabled: false }),
      saleFinder,
    });
    const before = await readState(context.db, context.merchantId);

    const result = await service.execute(sale.id, { reason: "Conflict at the counter" });

    expect(result).toMatchObject({ success: false, error: { code: codes.concurrentUpdateConflict } });
    expect(await readState(context.db, context.merchantId)).toEqual(before);
  });

  it("rechecks restock eligibility when a purchase commits after validation", async () => {
    const context = await setup();
    const sale = await createSale(context);
    const transaction = context.db.transaction.bind(context.db);
    vi.spyOn(context.db, "transaction").mockImplementationOnce(async (callback, configuration) => {
      const purchase = await context.purchaseService.execute({
        supplierId: context.supplierId,
        locationId: context.otherLocationId,
        lineItems: [{ variantId: context.siblingVariantId, quantity: 1, unitCost: "50.00" }],
      });
      expect(purchase.success).toBe(true);
      return transaction(callback, configuration);
    });

    const result = await context.voidService.execute(sale.id);

    expect(result).toMatchObject({ success: false, error: { code: codes.validationError } });
    const state = await readState(context.db, context.merchantId);
    expect(state.sales[0]).toMatchObject({ status: "fulfilled", voidReason: null, voidedAt: null });
    expect(state.inventoryLevels.find((level) => level.locationId === context.locationId)?.onHand).toBe(3);
    expect(state.inventoryLevels.find((level) => level.locationId === context.otherLocationId)?.onHand).toBe(8);
    expect(state.inventoryMovements.filter((movement) => movement.reason === "sale_void")).toHaveLength(0);
  });

  it("retries a changed inventory snapshot without losing the concurrent adjustment", async () => {
    const context = await setup();
    const sale = await createSale(context);
    const transaction = context.db.transaction.bind(context.db);
    vi.spyOn(context.db, "transaction").mockImplementationOnce(async (callback, configuration) => {
      await context.db
        .update(tables.inventoryLevel)
        .set({ onHand: 7 })
        .where(
          and(
            eq(tables.inventoryLevel.locationId, context.locationId),
            eq(tables.inventoryLevel.variantId, context.variantId),
          ),
        );
      return transaction(callback, configuration);
    });

    const result = await context.voidService.execute(sale.id);

    expect(result).toMatchObject({ success: true, value: { status: "voided" } });
    const state = await readState(context.db, context.merchantId);
    expect(state.inventoryLevels.find((level) => level.locationId === context.locationId)?.onHand).toBe(9);
    expect(state.inventoryMovements.filter((movement) => movement.reason === "sale_void")).toHaveLength(1);
  });

  it("allows voiding after another sale and a quantity correction", async () => {
    const context = await setup();
    const sale = await createSale(context);
    const laterSale = await createSale(context);
    await context.db
      .update(tables.inventoryLevel)
      .set({ onHand: 4 })
      .where(
        and(
          eq(tables.inventoryLevel.locationId, context.locationId),
          eq(tables.inventoryLevel.variantId, context.variantId),
        ),
      );
    const before = await readState(context.db, context.merchantId);

    const result = await context.voidService.execute(sale.id);

    expect(result).toMatchObject({ success: true, value: { status: "voided", voidReason: null } });
    const after = await readState(context.db, context.merchantId);
    expect(after.inventoryLevels.find((level) => level.locationId === context.locationId)?.onHand).toBe(6);
    expect(after.sales.find((record) => record.id === laterSale.id)).toEqual(
      before.sales.find((record) => record.id === laterSale.id),
    );
    expect(after.inventoryLevels.find((level) => level.locationId === context.otherLocationId)).toEqual(
      before.inventoryLevels.find((level) => level.locationId === context.otherLocationId),
    );
  });

  it("allows a restock strictly before the sale even when its business date is earlier", async () => {
    const context = await setup();
    const sale = await createSale(context);
    const lastRestockAt = new Date(sale.createdAt.getTime() - 1);
    await context.db.update(tables.product).set({ lastRestockAt }).where(eq(tables.product.id, context.productId));

    const result = await context.voidService.execute(sale.id);

    expect(result).toMatchObject({ success: true, value: { status: "voided" } });
    const state = await readState(context.db, context.merchantId);
    expect(state.products.find((product) => product.id === context.productId)?.lastRestockAt).toEqual(lastRestockAt);
    expect(state.inventoryLevels.find((level) => level.locationId === context.locationId)?.onHand).toBe(5);
  });

  it("rejects the whole sale when one of several products was restocked", async () => {
    const context = await setup();
    const otherProductId = generateId({ model: "product" });
    const otherVariantId = generateId({ model: "variant" });
    await context.db.insert(tables.product).values({
      id: otherProductId,
      merchantId: context.merchantId,
      name: "Sanji's rice",
      slug: "sanjis-rice",
      price: "10.00",
      unitCost: "5.00",
      type: "item",
      status: "active",
    });
    await context.db.insert(tables.variant).values({
      id: otherVariantId,
      merchantId: context.merchantId,
      productId: otherProductId,
      name: "Rice sack",
      price: "10.00",
    });
    await context.db.insert(tables.inventoryLevel).values({
      id: generateId({ model: "inventoryLevel" }),
      merchantId: context.merchantId,
      locationId: context.locationId,
      variantId: otherVariantId,
      onHand: 10,
    });
    const sale = await createSale(context, {
      ...context.saleRequest,
      lineItems: [...context.saleRequest.lineItems, { variantId: otherVariantId, quantity: 1, price: "10.00" }],
      payments: [{ method: "cash", amount: "210.00" }],
    });
    await context.db
      .update(tables.product)
      .set({ lastRestockAt: sale.createdAt })
      .where(eq(tables.product.id, otherProductId));
    const before = await readState(context.db, context.merchantId);

    const result = await context.voidService.execute(sale.id);

    expect(result).toMatchObject({ success: false, error: { code: codes.validationError } });
    expect(await readState(context.db, context.merchantId)).toEqual(before);
  });

  it("credits the void and its restocking movements to the requested employee", async () => {
    const context = await setup();
    const sale = await createSale(context);
    const usoppId = generateId({ model: "employee" });
    await context.db.insert(tables.employee).values({
      id: usoppId,
      merchantId: context.merchantId,
      name: "Usopp",
      status: "enabled",
      pin: "3333",
    });

    const result = await context.voidService.execute(sale.id, { voidedById: usoppId });

    expect(result).toMatchObject({
      success: true,
      value: { voidedBy: { id: usoppId, name: "Usopp" }, createdBy: { id: context.employeeId } },
    });
    const restocks = await context.db
      .select()
      .from(tables.inventoryMovement)
      .where(and(eq(tables.inventoryMovement.referenceId, sale.id), eq(tables.inventoryMovement.reason, "sale_void")));
    expect(restocks.length).toBeGreaterThan(0);
    expect(restocks.every((movement) => movement.createdById === usoppId)).toBe(true);
  });

  it("rejects crediting a disabled employee without voiding the sale", async () => {
    const context = await setup();
    const sale = await createSale(context);
    const usoppId = generateId({ model: "employee" });
    await context.db.insert(tables.employee).values({
      id: usoppId,
      merchantId: context.merchantId,
      name: "Usopp",
      status: "disabled",
      pin: "3333",
    });
    const before = await readState(context.db, context.merchantId);

    const result = await context.voidService.execute(sale.id, { voidedById: usoppId });

    expect(result).toMatchObject({ success: false, error: { code: codes.forbiddenError } });
    expect(await readState(context.db, context.merchantId)).toEqual(before);
  });
});
