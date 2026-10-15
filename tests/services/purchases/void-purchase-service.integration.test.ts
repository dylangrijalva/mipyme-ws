import { eq } from "drizzle-orm";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import type { CurrentUser } from "../../../src/contracts/current-user.ts";
import type { Database } from "../../../src/db/index.ts";
import { tables } from "../../../src/db/schema.ts";
import { CollectionFinder } from "../../../src/finders/collection-finder.ts";
import { ProductFinder } from "../../../src/finders/product-finder.ts";
import { PurchaseFinder } from "../../../src/finders/purchase-finder.ts";
import { SaleFinder } from "../../../src/finders/sale-finder.ts";
import { UpdateProductService } from "../../../src/services/catalog/products/update-product-service.ts";
import { CreatePurchaseService } from "../../../src/services/purchases/create-purchase-service.ts";
import { VoidPurchaseService } from "../../../src/services/purchases/void-purchase-service.ts";
import { CreateSaleService } from "../../../src/services/sales/create-sale-service.ts";
import { VoidSaleService } from "../../../src/services/sales/void-sale-service.ts";
import { ConcurrentUpdateError } from "../../../src/utils/concurrent-update-error.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import {
  createRealtimeEventPublisherMock,
  trackCommittedBroadcasts,
} from "../../test-utils/realtime-publisher-mock.ts";
import { waitForBlockedUpdate } from "../../test-utils/wait-for-blocked-update.ts";

const PURCHASE_TIME = new Date("2026-10-15T18:00:00.000Z");

async function setup() {
  const clock = vi.spyOn(Date, "now").mockReturnValue(PURCHASE_TIME.getTime());
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const employeeId = generateId({ model: "employee" });
  const locationId = generateId({ model: "location" });
  const otherLocationId = generateId({ model: "location" });
  const supplierId = generateId({ model: "supplier" });
  const productId = generateId({ model: "product" });
  const variantId = generateId({ model: "variant" });
  const siblingVariantId = generateId({ model: "variant" });
  await db.insert(tables.merchant).values({ id: merchantId, name: "Straw Hat Pirates", country: "ni" });
  await db
    .insert(tables.employee)
    .values({ id: employeeId, merchantId, name: "Nami", isOwner: true, status: "enabled" });
  await db.insert(tables.location).values([
    { id: locationId, merchantId, name: "Water 7" },
    { id: otherLocationId, merchantId, name: "Dressrosa" },
  ]);
  await db.insert(tables.supplier).values({ id: supplierId, merchantId, name: "Baratie" });
  await db.insert(tables.product).values({
    id: productId,
    merchantId,
    name: "Nami's mandarins",
    slug: productId,
    price: "30.00",
    unitCost: "8.00",
    type: "item",
    status: "active",
  });
  await db.insert(tables.variant).values([
    { id: variantId, merchantId, productId, name: "Mandarin crate", price: "30.00" },
    { id: siblingVariantId, merchantId, productId, name: "Mandarin basket", price: "30.00" },
  ]);
  await db.insert(tables.inventoryLevel).values([
    { id: generateId({ model: "inventoryLevel" }), merchantId, variantId, locationId, onHand: 6 },
    {
      id: generateId({ model: "inventoryLevel" }),
      merchantId,
      variantId: siblingVariantId,
      locationId: otherLocationId,
      onHand: 4,
    },
  ]);
  const user: CurrentUser = {
    id: employeeId,
    employeeId,
    merchantId,
    accountType: "owner",
    email: "nami@strawhatpirates.example.com",
  };
  const { broadcast, publisher } = createRealtimeEventPublisherMock();
  const dependencies = { db, user, logger: pino({ enabled: false }), publisher, purchaseFinder: new PurchaseFinder() };
  const purchaseService = CreatePurchaseService.create({
    ...dependencies,
    publisher: createRealtimeEventPublisherMock().publisher,
  });
  const voidService = VoidPurchaseService.create(dependencies);
  const saleDependencies = {
    ...dependencies,
    saleFinder: new SaleFinder(),
    publisher: createRealtimeEventPublisherMock().publisher,
  };
  const saleService = CreateSaleService.create(saleDependencies);
  const voidSaleService = VoidSaleService.create(saleDependencies);
  const request = { locationId, supplierId, lineItems: [{ variantId, quantity: 3, unitCost: "20.00" }] };
  const saleRequest = {
    locationId: otherLocationId,
    source: "pos.web" as const,
    businessDate: PURCHASE_TIME,
    lineItems: [{ variantId: siblingVariantId, quantity: 1, price: "30.00" }],
    payments: [{ method: "cash" as const, amount: "30.00" }],
  };
  return {
    db,
    clock,
    merchantId,
    employeeId,
    locationId,
    otherLocationId,
    supplierId,
    productId,
    variantId,
    siblingVariantId,
    broadcast,
    dependencies,
    purchaseService,
    voidService,
    saleService,
    voidSaleService,
    request,
    saleRequest,
  };
}

async function createPurchase(context: Awaited<ReturnType<typeof setup>>, request = context.request) {
  const result = await context.purchaseService.execute(request);
  if (!result.success) throw new Error(result.error.message);
  return result.value;
}

async function readState(db: Database) {
  return {
    products: await db.select().from(tables.product).orderBy(tables.product.id),
    levels: await db.select().from(tables.inventoryLevel).orderBy(tables.inventoryLevel.id),
    movements: await db.select().from(tables.inventoryMovement).orderBy(tables.inventoryMovement.id),
    purchases: await db.select().from(tables.purchaseOrder).orderBy(tables.purchaseOrder.id),
    items: await db.select().from(tables.purchaseOrderItem).orderBy(tables.purchaseOrderItem.id),
    supplierProducts: await db.select().from(tables.supplierProduct).orderBy(tables.supplierProduct.id),
    locations: await db.select().from(tables.location).orderBy(tables.location.id),
    sales: await db.select().from(tables.sale).orderBy(tables.sale.id),
  };
}

describe("VoidPurchaseService", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reverses all purchased variants once, restores the exact prior cost, and publishes committed audit details", async () => {
    const context = await setup();
    const otherProductId = generateId({ model: "product" });
    const otherVariantId = generateId({ model: "variant" });
    await context.db.insert(tables.product).values({
      id: otherProductId,
      merchantId: context.merchantId,
      name: "Sanji's rice",
      slug: otherProductId,
      price: "30.00",
      unitCost: "5.00",
      type: "item",
      status: "active",
    });
    await context.db.insert(tables.variant).values({
      id: otherVariantId,
      merchantId: context.merchantId,
      productId: otherProductId,
      name: "Rice sack",
      price: "30.00",
    });
    const purchase = await createPurchase(context, {
      ...context.request,
      lineItems: [
        ...context.request.lineItems,
        { variantId: context.siblingVariantId, quantity: 2, unitCost: "20.00" },
        { variantId: otherVariantId, quantity: 2, unitCost: "10.00" },
      ],
    });
    const before = await readState(context.db);
    expect(before.products.find((product) => product.id === context.productId)).toMatchObject({
      unitCost: "12.00",
      lastInventoryChangedAt: PURCHASE_TIME,
      lastSoldAt: null,
    });
    expect(before.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variantId: context.variantId, previousUnitCost: "8.00" }),
        expect.objectContaining({
          variantId: context.siblingVariantId,
          previousUnitCost: "8.00",
        }),
        expect.objectContaining({ variantId: otherVariantId, previousUnitCost: "5.00" }),
      ]),
    );
    const archivedAt = new Date("2026-10-15T18:00:00.500Z");
    await context.db.update(tables.product).set({ archivedAt }).where(eq(tables.product.id, context.productId));
    await context.db.update(tables.variant).set({ archivedAt }).where(eq(tables.variant.id, context.variantId));
    const committedAtPublish = trackCommittedBroadcasts(context.db, context.broadcast);
    const voidedAt = new Date("2026-10-15T18:00:01.000Z");
    context.clock.mockReturnValue(voidedAt.getTime());

    const result = await context.voidService.execute(purchase.id, { reason: "Wrong supplier delivery" });
    const repeated = await context.voidService.execute(purchase.id, { reason: "Replacement reason" });

    expect(result).toMatchObject({
      success: true,
      value: {
        id: purchase.id,
        status: "voided",
        lineItems: purchase.lineItems,
        createdAt: PURCHASE_TIME,
        voidReason: "Wrong supplier delivery",
        voidedBy: { id: context.employeeId, name: "Nami" },
        voidedAt,
      },
    });
    expect(repeated).toEqual(result);
    const after = await readState(context.db);
    expect(after.products.find((product) => product.id === context.productId)).toEqual({
      ...before.products.find((product) => product.id === context.productId),
      unitCost: "8.00",
      archivedAt,
      lastInventoryChangedAt: voidedAt,
      updatedAt: voidedAt,
    });
    expect(after.products.find((product) => product.id === otherProductId)).toEqual({
      ...before.products.find((product) => product.id === otherProductId),
      unitCost: "5.00",
      lastInventoryChangedAt: voidedAt,
      updatedAt: voidedAt,
    });
    expect(after.levels).toHaveLength(4);
    expect(after.levels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variantId: context.variantId, locationId: context.locationId, onHand: 6 }),
        expect.objectContaining({ variantId: context.siblingVariantId, locationId: context.locationId, onHand: 0 }),
        expect.objectContaining({ variantId: otherVariantId, locationId: context.locationId, onHand: 0 }),
        before.levels.find((level) => level.locationId === context.otherLocationId),
      ]),
    );
    const reversals = after.movements.filter((movement) => movement.reason === "purchase_void");
    expect(reversals).toHaveLength(3);
    expect(reversals.map((movement) => movement.quantityDelta).sort((left, right) => left - right)).toEqual([
      -3, -2, -2,
    ]);
    expect(reversals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          referenceId: purchase.id,
          fromState: "in_stock",
          toState: "none",
          unitCost: "20.00",
          createdById: context.employeeId,
          occurredAt: voidedAt,
        }),
      ]),
    );
    const riceLevel = after.levels.find((level) => level.variantId === otherVariantId)!;
    expect(reversals.find((movement) => movement.inventoryLevelId === riceLevel.id)).toMatchObject({
      referenceId: purchase.id,
      quantityDelta: -2,
      unitCost: "10.00",
      createdById: context.employeeId,
    });
    expect(after.movements.filter((movement) => movement.reason === "purchase")).toEqual(before.movements);
    expect(after.items).toEqual(before.items);
    expect(after.supplierProducts).toEqual(before.supplierProducts);
    expect(after.locations).toEqual(before.locations);
    expect(committedAtPublish).toEqual([true, true]);
    expect(context.broadcast).toHaveBeenCalledWith({
      merchantId: context.merchantId,
      resource: { type: "purchase_order", snapshot: result.success ? result.value : null },
    });
    expect(
      await context.dependencies.purchaseFinder.paginate(context.db, { merchantId: context.merchantId, limit: 10 }),
    ).toMatchObject({
      results: [expect.objectContaining({ voidedBy: { id: context.employeeId, name: "Nami" }, voidedAt })],
    });
  });

  it.each(["0.00", "8.00"])(
    "restores an initial cost of %s when voiding the first purchase into empty stock",
    async (unitCost) => {
      const context = await setup();
      await context.db.update(tables.product).set({ unitCost }).where(eq(tables.product.id, context.productId));
      await context.db.update(tables.inventoryLevel).set({ onHand: 0 });
      const purchase = await createPurchase(context);

      const result = await context.voidService.execute(purchase.id);

      expect(result).toMatchObject({ success: true, value: { voidReason: null } });
      const state = await readState(context.db);
      expect(state.products[0].unitCost).toBe(unitCost);
      expect(state.levels.map((level) => level.onHand)).toEqual([0, 0]);
    },
  );

  it("rejects a legacy purchase missing previous costs without changing state", async () => {
    const context = await setup();
    const purchase = await createPurchase(context);
    await context.db.update(tables.purchaseOrderItem).set({ previousUnitCost: null });
    const before = await readState(context.db);

    const result = await context.voidService.execute(purchase.id);

    expect(result).toMatchObject({ success: false, error: { code: codes.validationError } });
    expect(await readState(context.db)).toEqual(before);
    expect(context.broadcast).not.toHaveBeenCalled();
  });

  it("rejects voiding after a manual unit cost change without changing state", async () => {
    const context = await setup();
    await context.db.update(tables.product).set({ status: "draft" }).where(eq(tables.product.id, context.productId));
    const purchase = await createPurchase(context);
    const updateProductService = UpdateProductService.create({
      db: context.db,
      logger: pino({ enabled: false }),
      publisher: context.dependencies.publisher,
      collectionFinder: new CollectionFinder(),
      productFinder: new ProductFinder(),
      user: context.dependencies.user,
    });

    const updateResult = await updateProductService.execute([context.productId, { unitCost: "15.00" }]);
    expect(updateResult.success).toBe(true);
    context.broadcast.mockClear();
    const before = await readState(context.db);

    const result = await context.voidService.execute(purchase.id);

    expect(result).toMatchObject({ success: false, error: { code: codes.validationError } });
    expect(await readState(context.db)).toEqual(before);
    expect(context.broadcast).not.toHaveBeenCalled();
  });

  it.each(["sale", "sale_void", "purchase", "purchase_void"])(
    "blocks after a later %s of a sibling variant at another location",
    async (movement) => {
      const context = await setup();
      const purchase = await createPurchase(context);
      context.clock.mockReturnValue(PURCHASE_TIME.getTime() + 1000);
      if (movement.startsWith("sale")) {
        const sale = await context.saleService.execute(context.saleRequest);
        if (!sale.success) throw new Error(sale.error.message);
        if (movement === "sale_void") {
          context.clock.mockReturnValue(PURCHASE_TIME.getTime() + 2000);
          const voided = await context.voidSaleService.execute(sale.value.id);
          expect(voided.success).toBe(true);
          const [product] = await context.db.select().from(tables.product);
          expect(product.lastSoldAt).toEqual(new Date(PURCHASE_TIME.getTime() + 1000));
          expect(product.lastInventoryChangedAt).toEqual(new Date(PURCHASE_TIME.getTime() + 2000));
        }
      }
      if (movement.startsWith("purchase")) {
        const laterPurchase = await createPurchase(context, {
          ...context.request,
          locationId: context.otherLocationId,
          lineItems: [{ variantId: context.siblingVariantId, quantity: 1, unitCost: "15.00" }],
        });
        if (movement === "purchase_void") {
          context.clock.mockReturnValue(PURCHASE_TIME.getTime() + 2000);
          expect(await context.voidService.execute(laterPurchase.id)).toMatchObject({ success: true });
          context.broadcast.mockClear();
        }
      }
      const before = await readState(context.db);

      const result = await context.voidService.execute(purchase.id);

      expect(result).toMatchObject({ success: false, error: { code: codes.validationError } });
      expect(await readState(context.db)).toEqual(before);
      expect(context.broadcast).not.toHaveBeenCalled();
    },
  );

  it.each(["sale", "purchase", "correction"] as const)(
    "blocks a later %s even when it has the same timestamp as the purchase",
    async (movement) => {
      const context = await setup();
      const purchase = await createPurchase(context);
      if (movement === "sale") {
        const sale = await context.saleService.execute(context.saleRequest);
        expect(sale.success).toBe(true);
      }
      if (movement === "purchase") {
        await createPurchase(context, {
          ...context.request,
          locationId: context.otherLocationId,
          lineItems: [{ variantId: context.siblingVariantId, quantity: 1, unitCost: "15.00" }],
        });
      }
      if (movement === "correction") {
        const [level] = await context.db
          .select()
          .from(tables.inventoryLevel)
          .where(eq(tables.inventoryLevel.locationId, context.otherLocationId));
        await context.db.transaction(async (transaction) => {
          await transaction
            .update(tables.product)
            .set({
              lastInventoryChangedAt: PURCHASE_TIME,
            })
            .where(eq(tables.product.id, context.productId));
          await transaction
            .update(tables.inventoryLevel)
            .set({ onHand: 5 })
            .where(eq(tables.inventoryLevel.id, level.id));
          await transaction.insert(tables.inventoryMovement).values({
            id: generateId({ model: "inventoryMovement" }),
            merchantId: context.merchantId,
            inventoryLevelId: level.id,
            referenceId: purchase.id,
            reason: "correction",
            fromState: "in_stock",
            toState: "in_stock",
            quantityDelta: 1,
            unitCost: "10.77",
            createdById: context.employeeId,
            occurredAt: PURCHASE_TIME,
          });
        });
      }
      const before = await readState(context.db);
      expect(before.products[0].lastInventoryChangedAt).toEqual(purchase.createdAt);

      const result = await context.voidService.execute(purchase.id);

      expect(result).toMatchObject({ success: false, error: { code: codes.validationError } });
      expect(await readState(context.db)).toEqual(before);
    },
  );

  it("allows voiding after a sale strictly before the purchase", async () => {
    const context = await setup();
    context.clock.mockReturnValue(PURCHASE_TIME.getTime() - 1);
    const sale = await context.saleService.execute(context.saleRequest);
    expect(sale.success).toBe(true);
    context.clock.mockReturnValue(PURCHASE_TIME.getTime());
    const purchase = await createPurchase(context);

    const result = await context.voidService.execute(purchase.id);

    expect(result.success).toBe(true);
    const after = await readState(context.db);
    expect(after.products[0]).toMatchObject({ unitCost: "8.00", lastSoldAt: new Date(PURCHASE_TIME.getTime() - 1) });
    expect(after.levels.find((level) => level.locationId === context.otherLocationId)?.onHand).toBe(3);
  });

  it("rejects the entire purchase after an adjustment to one of its products", async () => {
    const context = await setup();
    const otherProductId = generateId({ model: "product" });
    const otherVariantId = generateId({ model: "variant" });
    await context.db.insert(tables.product).values({
      id: otherProductId,
      merchantId: context.merchantId,
      name: "Sanji's rice",
      slug: otherProductId,
      price: "30.00",
      unitCost: "5.00",
      type: "item",
      status: "active",
    });
    await context.db.insert(tables.variant).values({
      id: otherVariantId,
      merchantId: context.merchantId,
      productId: otherProductId,
      name: "Rice sack",
      price: "30.00",
    });
    const purchase = await createPurchase(context, {
      ...context.request,
      lineItems: [...context.request.lineItems, { variantId: otherVariantId, quantity: 2, unitCost: "10.00" }],
    });
    const adjustedAt = new Date(PURCHASE_TIME.getTime() + 1000);
    const [level] = await context.db
      .select()
      .from(tables.inventoryLevel)
      .where(eq(tables.inventoryLevel.variantId, otherVariantId));
    await context.db.transaction(async (transaction) => {
      await transaction
        .update(tables.product)
        .set({
          lastInventoryChangedAt: adjustedAt,
          updatedAt: adjustedAt,
        })
        .where(eq(tables.product.id, otherProductId));
      await transaction
        .update(tables.inventoryLevel)
        .set({ onHand: 1, updatedAt: adjustedAt })
        .where(eq(tables.inventoryLevel.id, level.id));
      await transaction.insert(tables.inventoryMovement).values({
        id: generateId({ model: "inventoryMovement" }),
        merchantId: context.merchantId,
        inventoryLevelId: level.id,
        referenceId: purchase.id,
        reason: "correction",
        fromState: "in_stock",
        toState: "in_stock",
        quantityDelta: -1,
        unitCost: "10.00",
        createdById: context.employeeId,
        occurredAt: adjustedAt,
      });
    });
    const before = await readState(context.db);

    const result = await context.voidService.execute(purchase.id);

    expect(result).toMatchObject({ success: false, error: { code: codes.validationError } });
    expect(await readState(context.db)).toEqual(before);
  });

  it("allows a void after a pending sale that did not move inventory", async () => {
    const context = await setup();
    const purchase = await createPurchase(context);
    await context.db
      .update(tables.location)
      .set({ allowBackorders: true })
      .where(eq(tables.location.id, context.otherLocationId));
    context.clock.mockReturnValue(PURCHASE_TIME.getTime() + 1000);
    const sale = await context.saleService.execute({
      ...context.saleRequest,
      lineItems: [{ variantId: context.siblingVariantId, quantity: 10, price: "30.00" }],
      payments: [{ method: "cash", amount: "300.00" }],
    });
    expect(sale).toMatchObject({ success: true, value: { status: "pending" } });

    const result = await context.voidService.execute(purchase.id);

    expect(result.success).toBe(true);
    expect((await readState(context.db)).products[0]).toMatchObject({ unitCost: "8.00", lastSoldAt: null });
  });

  it.each([
    {
      name: "enabled staff",
      permissions: "void_transaction",
      status: "enabled",
      locationAccess: true,
      isOwner: false,
      allowed: true,
    },
    {
      name: "staff without permission",
      permissions: "manage_inventory",
      status: "enabled",
      locationAccess: true,
      isOwner: false,
      allowed: false,
    },
    {
      name: "staff with the obsolete permission",
      permissions: "void_sales",
      status: "enabled",
      locationAccess: true,
      isOwner: false,
      allowed: false,
    },
    {
      name: "staff without location access",
      permissions: "void_transaction",
      status: "enabled",
      locationAccess: false,
      isOwner: false,
      allowed: false,
    },
    {
      name: "disabled staff",
      permissions: "void_transaction",
      status: "disabled",
      locationAccess: true,
      isOwner: false,
      allowed: false,
    },
    {
      name: "disabled owner",
      permissions: "",
      status: "disabled",
      locationAccess: false,
      isOwner: true,
      allowed: false,
    },
  ] as const)(
    "enforces void authorization for $name",
    async ({ permissions, status, locationAccess, isOwner, allowed }) => {
      const context = await setup();
      const purchase = await createPurchase(context);
      await context.db
        .update(tables.employee)
        .set({ permissions, status, isOwner })
        .where(eq(tables.employee.id, context.employeeId));
      if (locationAccess) {
        await context.db.insert(tables.locationAccess).values({
          id: generateId(),
          merchantId: context.merchantId,
          locationId: context.locationId,
          employeeId: context.employeeId,
        });
      }
      const before = await readState(context.db);

      const result = await context.voidService.execute(purchase.id);

      if (allowed) {
        expect(result).toMatchObject({ success: true, value: { status: "voided" } });
        return;
      }
      expect(result).toMatchObject({ success: false, error: { code: codes.forbiddenError } });
      expect(await readState(context.db)).toEqual(before);
      expect(context.broadcast).not.toHaveBeenCalled();
    },
  );

  it("hides foreign and missing purchases without changing either merchant's state", async () => {
    const context = await setup();
    const purchase = await createPurchase(context);
    const merchantId = generateId({ model: "merchant" });
    const employeeId = generateId({ model: "employee" });
    await context.db.insert(tables.merchant).values({ id: merchantId, name: "Heart Pirates", country: "ni" });
    await context.db
      .insert(tables.employee)
      .values({ id: employeeId, merchantId, name: "Trafalgar Law", status: "enabled", isOwner: true });
    const service = VoidPurchaseService.create({
      ...context.dependencies,
      user: { ...context.dependencies.user, merchantId, employeeId },
    });
    const before = await readState(context.db);

    const foreign = await service.execute(purchase.id);
    const missing = await context.voidService.execute(generateId({ model: "purchaseOrder" }));

    expect(foreign).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    expect(missing).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    expect(await readState(context.db)).toEqual(before);
  });

  it.each([false, true])("rolls back a conflict after writes, with exhausted retries: %s", async (exhausted) => {
    const context = await setup();
    const purchase = await createPurchase(context);
    const finder = vi.spyOn(context.dependencies.purchaseFinder, "find");
    if (exhausted) finder.mockRejectedValue(new ConcurrentUpdateError());
    if (!exhausted) finder.mockRejectedValueOnce(new ConcurrentUpdateError());
    const before = await readState(context.db);

    const result = await context.voidService.execute(purchase.id);

    if (exhausted) {
      expect(result).toMatchObject({ success: false, error: { code: codes.concurrentUpdateConflict } });
      expect(await readState(context.db)).toEqual(before);
      expect(context.broadcast).not.toHaveBeenCalled();
      return;
    }
    expect(result.success).toBe(true);
    const after = await readState(context.db);
    expect(after.levels.find((level) => level.variantId === context.variantId)?.onHand).toBe(6);
    expect(after.products[0]).toMatchObject({ unitCost: "8.00" });
    expect(after.movements.filter((movement) => movement.reason === "purchase_void")).toHaveLength(1);
  });

  it("rechecks eligibility when another location sells a sibling variant after validation", async () => {
    const context = await setup();
    const purchase = await createPurchase(context);
    const transaction = context.db.transaction.bind(context.db);
    vi.spyOn(context.db, "transaction").mockImplementationOnce(async (callback, configuration) => {
      const sale = await context.saleService.execute(context.saleRequest);
      if (!sale.success) throw new Error(sale.error.message);
      return transaction(callback, configuration);
    });

    const result = await context.voidService.execute(purchase.id);

    expect(result).toMatchObject({ success: false, error: { code: codes.validationError } });
    const after = await readState(context.db);
    expect(after.purchases[0]).toMatchObject({ status: "fulfilled", voidedAt: null });
    expect(after.products[0]).toMatchObject({ unitCost: "10.77" });
    expect(after.levels.find((level) => level.locationId === context.locationId)?.onHand).toBe(9);
    expect(after.levels.find((level) => level.locationId === context.otherLocationId)?.onHand).toBe(3);
    expect(after.movements.filter((movement) => movement.reason === "purchase_void")).toEqual([]);
    expect(context.broadcast).not.toHaveBeenCalled();
  });

  it("serializes simultaneous voids so both callers receive the same result and stock is reversed once", async () => {
    const context = await setup();
    const purchase = await createPurchase(context);

    const results = await waitForBlockedUpdate(context.db, "products", "void_purchase_once", () =>
      Promise.all([
        context.voidService.execute(purchase.id, { reason: "Duplicate delivery" }),
        context.voidService.execute(purchase.id, { reason: "Duplicate delivery" }),
      ]),
    );

    expect(results[0]).toMatchObject({ success: true, value: { status: "voided" } });
    expect(results[1]).toEqual(results[0]);
    const after = await readState(context.db);
    expect(after.products[0]).toMatchObject({ unitCost: "8.00" });
    expect(after.levels.find((level) => level.locationId === context.locationId)?.onHand).toBe(6);
    expect(after.movements.filter((movement) => movement.reason === "purchase_void")).toHaveLength(1);
  });
});
