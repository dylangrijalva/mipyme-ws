import { and, eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import type { Database } from "../../../src/db/index.ts";
import { tables } from "../../../src/db/schema.ts";
import { PurchaseFinder } from "../../../src/finders/purchase-finder.ts";
import {
  CreatePurchaseRequest,
  CreatePurchaseService,
} from "../../../src/services/purchases/create-purchase-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import {
  createRealtimeEventPublisherMock,
  trackCommittedBroadcasts,
} from "../../test-utils/realtime-publisher-mock.ts";
import { waitForBlockedUpdate } from "../../test-utils/wait-for-blocked-update.ts";

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const employeeId = generateId({ model: "employee" });
  const supplierId = generateId({ model: "supplier" });
  const locationId = generateId({ model: "location" });
  const otherLocationId = generateId({ model: "location" });
  const productId = generateId({ model: "product" });
  const mandarinVariantId = generateId({ model: "variant" });
  const seafoodVariantId = generateId({ model: "variant" });

  await db.insert(tables.merchant).values({ id: merchantId, name: "Straw Hat Pirates", country: "ni" });
  await db.insert(tables.employee).values({ id: employeeId, merchantId, name: "Sanji", isOwner: true });
  await db.insert(tables.supplier).values({ id: supplierId, merchantId, name: "Baratie" });
  await db.insert(tables.location).values([
    { id: locationId, merchantId, name: "Water 7", nextPurchaseOrderNumber: 42 },
    { id: otherLocationId, merchantId, name: "Dressrosa" },
  ]);
  await db.insert(tables.product).values({
    id: productId,
    merchantId,
    name: "Sanji's provisions",
    slug: "sanjis-provisions",
    price: "25.00",
    unitCost: "8.00",
    type: "item",
    status: "active",
  });
  await db.insert(tables.variant).values([
    {
      id: mandarinVariantId,
      merchantId,
      productId,
      name: "Nami's mandarin crate",
      price: "25.00",
    },
    {
      id: seafoodVariantId,
      merchantId,
      productId,
      name: "Sanji's seafood crate",
      price: "30.00",
    },
  ]);
  await db.insert(tables.inventoryLevel).values([
    {
      id: generateId({ model: "inventoryLevel" }),
      merchantId,
      locationId,
      variantId: mandarinVariantId,
      onHand: 6,
    },
    {
      id: generateId({ model: "inventoryLevel" }),
      merchantId,
      locationId: otherLocationId,
      variantId: seafoodVariantId,
      onHand: 4,
    },
  ]);

  const { broadcast, publisher } = createRealtimeEventPublisherMock();
  const service = CreatePurchaseService.create({
    publisher,
    db,
    purchaseFinder: new PurchaseFinder(),
    logger: pino({ enabled: false }),
    user: {
      id: "sanji",
      email: "sanji@strawhatpirates.example.com",
      employeeId,
      accountType: "owner",
      merchantId,
    },
  });

  return {
    broadcast,
    db,
    service,
    merchantId,
    employeeId,
    supplierId,
    locationId,
    otherLocationId,
    productId,
    mandarinVariantId,
    seafoodVariantId,
  };
}

async function readState(db: Database, merchantId: string) {
  return {
    products: await db
      .select()
      .from(tables.product)
      .where(eq(tables.product.merchantId, merchantId))
      .orderBy(tables.product.id),
    locations: await db
      .select()
      .from(tables.location)
      .where(eq(tables.location.merchantId, merchantId))
      .orderBy(tables.location.id),
    supplierProducts: await db
      .select()
      .from(tables.supplierProduct)
      .where(eq(tables.supplierProduct.merchantId, merchantId))
      .orderBy(tables.supplierProduct.id),
    purchases: await db
      .select()
      .from(tables.purchaseOrder)
      .where(eq(tables.purchaseOrder.merchantId, merchantId))
      .orderBy(tables.purchaseOrder.id),
    purchaseItems: await db
      .select()
      .from(tables.purchaseOrderItem)
      .where(eq(tables.purchaseOrderItem.merchantId, merchantId))
      .orderBy(tables.purchaseOrderItem.id),
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
  };
}

function createDeferred() {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

function holdAndUpdateProduct(db: Database, merchantId: string, productId: string) {
  const acquired = createDeferred();
  const release = createDeferred();
  const finished = db.transaction(async (transaction) => {
    await transaction
      .select({ id: tables.product.id })
      .from(tables.product)
      .where(and(eq(tables.product.merchantId, merchantId), eq(tables.product.id, productId)))
      .for("update");
    acquired.resolve();
    await release.promise;
    await transaction
      .update(tables.product)
      .set({ updatedAt: sql`DATE_ADD(${tables.product.updatedAt}, INTERVAL 1000 MICROSECOND)` })
      .where(and(eq(tables.product.merchantId, merchantId), eq(tables.product.id, productId)));
  });

  return { acquired: acquired.promise, release: release.resolve, finished };
}

async function waitForProductRowLockWaits(db: Database, expectedWaits: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const [rowLockWaits] = await db
          .select({ waiting: sql<number>`count(DISTINCT performance_schema.data_locks.THREAD_ID)`.mapWith(Number) })
          .from(sql`performance_schema.data_lock_waits`)
          .innerJoin(
            sql`performance_schema.data_locks`,
            sql`
              performance_schema.data_lock_waits.REQUESTING_ENGINE_LOCK_ID =
              performance_schema.data_locks.ENGINE_LOCK_ID
            `,
          ).where(sql`
            performance_schema.data_locks.OBJECT_SCHEMA = DATABASE()
            AND performance_schema.data_locks.OBJECT_NAME = 'products'
            AND performance_schema.data_locks.INDEX_NAME = 'PRIMARY'
          `);

        return rowLockWaits.waiting;
      },
      { timeout: 5_000 },
    )
    .toBe(expectedWaits);
}

afterEach(() => vi.restoreAllMocks());

describe("CreatePurchaseService", () => {
  it("creates a fulfilled purchase, receives stock at one location, and recalculates the product-wide unit cost", async () => {
    const {
      broadcast,
      db,
      service,
      merchantId,
      employeeId,
      supplierId,
      locationId,
      otherLocationId,
      productId,
      mandarinVariantId,
      seafoodVariantId,
    } = await setup();

    const committedAtPublish = trackCommittedBroadcasts(db, broadcast);

    const result = await service.execute(
      CreatePurchaseRequest.parse({
        supplierId,
        locationId,
        notes: "Replenishment for the galley",
        lineItems: [
          { variantId: mandarinVariantId, quantity: 3, unitCost: "9.00" },
          { variantId: seafoodVariantId, quantity: 2, unitCost: "10.00" },
        ],
      }),
    );

    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "purchase_order", snapshot: result.value },
    });
    expect(committedAtPublish).toEqual([true]);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Purchase creation failed.");
    }

    expect(result.value).toMatchObject({
      transactionNumber: 42,
      status: "fulfilled",
      locationId,
      supplier: { id: supplierId, name: "Baratie" },
      notes: "Replenishment for the galley",
      lineItems: expect.arrayContaining([
        expect.objectContaining({
          unitCost: "9.00",
          price: "25.00",
          variants: [{ id: mandarinVariantId, name: "Nami's mandarin crate", quantity: 3 }],
        }),
        expect.objectContaining({
          unitCost: "10.00",
          price: "30.00",
          variants: [{ id: seafoodVariantId, name: "Sanji's seafood crate", quantity: 2 }],
        }),
      ]),
    });

    const [product] = await db
      .select({ unitCost: tables.product.unitCost })
      .from(tables.product)
      .where(and(eq(tables.product.merchantId, merchantId), eq(tables.product.id, productId)));
    expect(product).toEqual({ unitCost: "8.47" });

    const [location] = await db
      .select({ nextPurchaseOrderNumber: tables.location.nextPurchaseOrderNumber })
      .from(tables.location)
      .where(and(eq(tables.location.merchantId, merchantId), eq(tables.location.id, locationId)));
    expect(location?.nextPurchaseOrderNumber).toBe(43);

    const [otherLocation] = await db
      .select({ nextPurchaseOrderNumber: tables.location.nextPurchaseOrderNumber })
      .from(tables.location)
      .where(and(eq(tables.location.merchantId, merchantId), eq(tables.location.id, otherLocationId)));
    expect(otherLocation?.nextPurchaseOrderNumber).toBe(1);

    const [purchase] = await db
      .select()
      .from(tables.purchaseOrder)
      .where(and(eq(tables.purchaseOrder.merchantId, merchantId), eq(tables.purchaseOrder.id, result.value.id)));
    expect(purchase).toMatchObject({
      id: result.value.id,
      status: "fulfilled",
      transactionNumber: 42,
      notes: "Replenishment for the galley",
      supplierId,
      locationId,
      createdById: employeeId,
    });

    const purchaseItems = await db
      .select()
      .from(tables.purchaseOrderItem)
      .where(
        and(
          eq(tables.purchaseOrderItem.merchantId, merchantId),
          eq(tables.purchaseOrderItem.purchaseOrderId, result.value.id),
        ),
      );
    expect(purchaseItems).toHaveLength(2);
    expect(purchaseItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Nami's mandarin crate",
          quantity: 3,
          price: "25.00",
          unitCost: "9.00",
          variantId: mandarinVariantId,
        }),
        expect.objectContaining({
          name: "Sanji's seafood crate",
          quantity: 2,
          price: "30.00",
          unitCost: "10.00",
          variantId: seafoodVariantId,
        }),
      ]),
    );

    const inventory = await db
      .select({
        locationId: tables.inventoryLevel.locationId,
        variantId: tables.inventoryLevel.variantId,
        onHand: tables.inventoryLevel.onHand,
        lastSoldAt: tables.inventoryLevel.lastSoldAt,
        lastRestockAt: tables.inventoryLevel.lastRestockAt,
        lastInventoryAdjustmentAt: tables.inventoryLevel.lastInventoryAdjustmentAt,
      })
      .from(tables.inventoryLevel)
      .where(eq(tables.inventoryLevel.merchantId, merchantId));
    const restocked = {
      lastSoldAt: null,
      lastRestockAt: result.value.createdAt,
      lastInventoryAdjustmentAt: result.value.createdAt,
    };
    expect(inventory).toHaveLength(3);
    expect(inventory).toEqual(
      expect.arrayContaining([
        { locationId, variantId: mandarinVariantId, onHand: 9, ...restocked },
        { locationId, variantId: seafoodVariantId, onHand: 2, ...restocked },
        {
          locationId: otherLocationId,
          variantId: seafoodVariantId,
          onHand: 4,
          lastSoldAt: null,
          lastRestockAt: null,
          lastInventoryAdjustmentAt: null,
        },
      ]),
    );

    const purchaseId = result.value.id;
    const movements = await db
      .select({
        locationId: tables.inventoryLevel.locationId,
        variantId: tables.inventoryLevel.variantId,
        reason: tables.inventoryMovement.reason,
        fromState: tables.inventoryMovement.fromState,
        toState: tables.inventoryMovement.toState,
        quantityDelta: tables.inventoryMovement.quantityDelta,
        unitCost: tables.inventoryMovement.unitCost,
        referenceId: tables.inventoryMovement.referenceId,
        createdById: tables.inventoryMovement.createdById,
      })
      .from(tables.inventoryMovement)
      .innerJoin(tables.inventoryLevel, eq(tables.inventoryMovement.inventoryLevelId, tables.inventoryLevel.id))
      .where(
        and(eq(tables.inventoryMovement.merchantId, merchantId), eq(tables.inventoryMovement.referenceId, purchaseId)),
      );
    expect(movements).toHaveLength(2);
    expect(movements).toEqual(
      expect.arrayContaining([
        {
          locationId,
          variantId: mandarinVariantId,
          reason: "purchase",
          fromState: "in_stock",
          toState: "in_stock",
          quantityDelta: 3,
          unitCost: "9.00",
          referenceId: purchaseId,
          createdById: employeeId,
        },
        {
          locationId,
          variantId: seafoodVariantId,
          reason: "purchase",
          fromState: "none",
          toState: "in_stock",
          quantityDelta: 2,
          unitCost: "10.00",
          referenceId: purchaseId,
          createdById: employeeId,
        },
      ]),
    );

    const supplierProducts = await db
      .select()
      .from(tables.supplierProduct)
      .where(and(eq(tables.supplierProduct.merchantId, merchantId), eq(tables.supplierProduct.productId, productId)));
    expect(supplierProducts).toHaveLength(1);
    expect(supplierProducts[0]).toMatchObject({ supplierId, productId });
  });

  it("rejects service products without changing persisted state", async () => {
    const { db, service, merchantId, supplierId, locationId } = await setup();
    const serviceProductId = generateId({ model: "product" });
    const serviceVariantId = generateId({ model: "variant" });

    await db.insert(tables.product).values({
      id: serviceProductId,
      merchantId,
      name: "Chopper's treatment",
      slug: "choppers-treatment",
      price: "25.00",
      unitCost: "0.00",
      type: "service",
      status: "active",
    });
    await db.insert(tables.variant).values({
      id: serviceVariantId,
      merchantId,
      productId: serviceProductId,
      name: "Chopper's treatment",
      price: "25.00",
    });
    const before = await readState(db, merchantId);

    const result = await service.execute(
      CreatePurchaseRequest.parse({
        supplierId,
        locationId,
        lineItems: [{ variantId: serviceVariantId, quantity: 1, unitCost: "10.00" }],
      }),
    );

    expect(result).toMatchObject({ success: false, error: { code: codes.validationError } });
    expect(await readState(db, merchantId)).toEqual(before);
  });

  it("rejects duplicate variants without changing persisted state", async () => {
    const { db, service, merchantId, supplierId, locationId, mandarinVariantId } = await setup();
    const before = await readState(db, merchantId);

    const result = await service.execute(
      CreatePurchaseRequest.parse({
        supplierId,
        locationId,
        lineItems: [
          { variantId: mandarinVariantId, quantity: 1, unitCost: "9.00" },
          { variantId: mandarinVariantId, quantity: 2, unitCost: "10.00" },
        ],
      }),
    );

    expect(result).toMatchObject({ success: false, error: { code: codes.validationError } });
    expect(await readState(db, merchantId)).toEqual(before);
  });

  it("rolls back purchase and inventory changes when recording a movement fails", async () => {
    const { db, service, merchantId, supplierId, locationId, mandarinVariantId } = await setup();
    const before = await readState(db, merchantId);
    const transactionSpy = vi.spyOn(db, "transaction");
    await db.execute(sql`
      CREATE TRIGGER reject_purchase_movement BEFORE INSERT ON inventory_movements
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Inventory movement storage unavailable'
    `);

    try {
      await expect(
        service.execute(
          CreatePurchaseRequest.parse({
            supplierId,
            locationId,
            lineItems: [{ variantId: mandarinVariantId, quantity: 3, unitCost: "9.00" }],
          }),
        ),
      ).rejects.toMatchObject({
        cause: { sqlState: "45000", sqlMessage: "Inventory movement storage unavailable" },
      });
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(await readState(db, merchantId)).toEqual(before);
    } finally {
      try {
        await db.execute(sql`DROP TRIGGER reject_purchase_movement`);
      } finally {
        transactionSpy.mockRestore();
      }
    }
  });

  it("returns a not-found error without retrying", async () => {
    const { db, service, merchantId, locationId, mandarinVariantId } = await setup();
    const missingSupplierId = generateId({ model: "supplier" });
    const before = await readState(db, merchantId);
    const transactionSpy = vi.spyOn(db, "transaction");

    try {
      const result = await service.execute(
        CreatePurchaseRequest.parse({
          supplierId: missingSupplierId,
          locationId,
          lineItems: [{ variantId: mandarinVariantId, quantity: 3, unitCost: "9.00" }],
        }),
      );

      expect(result).toEqual({
        success: false,
        error: {
          code: codes.resourceNotFound,
          message: `Supplier ${missingSupplierId} has not been found.`,
          details: [],
        },
      });
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(await readState(db, merchantId)).toEqual(before);
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it("returns the final conflict after three transaction attempts", async () => {
    const { db, service, merchantId, supplierId, locationId, productId, mandarinVariantId } = await setup();
    const before = await readState(db, merchantId);
    const request = CreatePurchaseRequest.parse({
      supplierId,
      locationId,
      lineItems: [{ variantId: mandarinVariantId, quantity: 3, unitCost: "9.00" }],
    });
    const transactionSpy = vi.spyOn(db, "transaction");
    const productLocks: Array<ReturnType<typeof holdAndUpdateProduct>> = [];
    let createPurchase: ReturnType<typeof service.execute> | undefined;

    try {
      const firstProductLock = holdAndUpdateProduct(db, merchantId, productId);
      productLocks.push(firstProductLock);
      await firstProductLock.acquired;

      createPurchase = service.execute(request);
      await waitForProductRowLockWaits(db, 1);

      const secondProductLock = holdAndUpdateProduct(db, merchantId, productId);
      productLocks.push(secondProductLock);
      await waitForProductRowLockWaits(db, 2);

      firstProductLock.release();
      await firstProductLock.finished;
      await secondProductLock.acquired;
      await waitForProductRowLockWaits(db, 1);

      const thirdProductLock = holdAndUpdateProduct(db, merchantId, productId);
      productLocks.push(thirdProductLock);
      await waitForProductRowLockWaits(db, 2);

      secondProductLock.release();
      await secondProductLock.finished;
      await thirdProductLock.acquired;
      await waitForProductRowLockWaits(db, 1);

      thirdProductLock.release();
      await thirdProductLock.finished;

      const result = await createPurchase;

      expect(result).toEqual({
        success: false,
        error: {
          code: codes.concurrentUpdateConflict,
          message: "Inventory changed while the purchase was being created. Retry the request.",
          details: [],
        },
      });
      expect(transactionSpy).toHaveBeenCalledTimes(6);

      const state = await readState(db, merchantId);
      expect(state.products.find(({ id }) => id === productId)).toMatchObject({
        unitCost: "8.00",
      });
      expect(state.locations).toEqual(before.locations);
      expect(state.supplierProducts).toEqual(before.supplierProducts);
      expect(state.purchases).toEqual(before.purchases);
      expect(state.purchaseItems).toEqual(before.purchaseItems);
      expect(state.inventoryLevels).toEqual(before.inventoryLevels);
      expect(state.inventoryMovements).toEqual(before.inventoryMovements);
    } finally {
      for (const productLock of productLocks) productLock.release();
      await Promise.allSettled(productLocks.map(({ finished }) => finished));
      if (createPurchase) {
        await Promise.allSettled([createPurchase]);
      }
      transactionSpy.mockRestore();
    }
  }, 15_000);

  it("serializes purchases of the same product without losing received quantities or costs", async () => {
    const {
      db,
      service,
      merchantId,
      supplierId,
      locationId,
      otherLocationId,
      productId,
      mandarinVariantId,
      seafoodVariantId,
    } = await setup();
    const lockName = `create_purchase_${generateId({ length: 18 })}`;
    const request = CreatePurchaseRequest.parse({
      supplierId,
      locationId,
      lineItems: [{ variantId: mandarinVariantId, quantity: 3, unitCost: "9.00" }],
    });
    const results = await waitForBlockedUpdate(db, "products", lockName, () =>
      Promise.all([service.execute(request), service.execute(request)]),
    );

    expect(results).toHaveLength(2);
    expect(results.every(({ success }) => success)).toBe(true);

    const state = await readState(db, merchantId);
    expect(state.products.find(({ id }) => id === productId)).toMatchObject({ unitCost: "8.37" });
    expect(state.locations.find(({ id }) => id === locationId)?.nextPurchaseOrderNumber).toBe(44);
    expect(state.purchases).toHaveLength(2);
    expect(state.purchases.map(({ transactionNumber }) => transactionNumber).sort()).toEqual([42, 43]);
    expect(new Set(state.purchases.map(({ transactionNumber }) => transactionNumber)).size).toBe(2);
    expect(state.purchaseItems).toHaveLength(2);
    expect(new Set(state.purchaseItems.map(({ purchaseOrderId }) => purchaseOrderId))).toEqual(
      new Set(state.purchases.map(({ id }) => id)),
    );
    expect(state.supplierProducts).toHaveLength(1);
    expect(state.inventoryLevels).toHaveLength(2);
    expect(state.inventoryLevels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ locationId, variantId: mandarinVariantId, onHand: 12 }),
        expect.objectContaining({ locationId: otherLocationId, variantId: seafoodVariantId, onHand: 4 }),
      ]),
    );
    expect(state.inventoryMovements).toHaveLength(2);
    expect(state.inventoryMovements.map(({ referenceId }) => referenceId).sort()).toEqual(
      state.purchases.map(({ id }) => id).sort(),
    );
    expect(state.inventoryMovements.map(({ quantityDelta }) => quantityDelta)).toEqual([3, 3]);
  }, 15_000);

  it("retries a purchase after the location purchase number changes", async () => {
    const {
      db,
      service,
      merchantId,
      supplierId,
      locationId,
      otherLocationId,
      productId,
      mandarinVariantId,
      seafoodVariantId,
    } = await setup();
    const otherProductId = generateId({ model: "product" });
    const otherVariantId = generateId({ model: "variant" });
    await db.insert(tables.product).values({
      id: otherProductId,
      merchantId,
      name: "Franky's cola",
      slug: "frankys-cola",
      price: "40.00",
      unitCost: "12.00",
      type: "item",
      status: "active",
    });
    await db.insert(tables.variant).values({
      id: otherVariantId,
      merchantId,
      productId: otherProductId,
      name: "Franky's cola crate",
      price: "40.00",
    });
    const lockName = `purchase_number_${generateId({ length: 18 })}`;
    const requests = [
      CreatePurchaseRequest.parse({
        supplierId,
        locationId,
        lineItems: [{ variantId: mandarinVariantId, quantity: 3, unitCost: "9.00" }],
      }),
      CreatePurchaseRequest.parse({
        supplierId,
        locationId,
        lineItems: [{ variantId: otherVariantId, quantity: 2, unitCost: "13.00" }],
      }),
    ];

    const results = await waitForBlockedUpdate(db, "locations", lockName, () =>
      Promise.all(requests.map((request) => service.execute(request))),
    );

    expect(results).toHaveLength(2);
    expect(results.every(({ success }) => success)).toBe(true);
    const state = await readState(db, merchantId);

    expect(state.products.find(({ id }) => id === productId)).toMatchObject({ unitCost: "8.23" });
    expect(state.products.find(({ id }) => id === otherProductId)).toMatchObject({
      unitCost: "13.00",
    });
    expect(state.locations.find(({ id }) => id === locationId)?.nextPurchaseOrderNumber).toBe(44);
    expect(state.locations.find(({ id }) => id === otherLocationId)?.nextPurchaseOrderNumber).toBe(1);
    expect(state.purchases).toHaveLength(2);
    expect(state.purchases.map(({ transactionNumber }) => transactionNumber).sort()).toEqual([42, 43]);
    expect(new Set(state.purchases.map(({ transactionNumber }) => transactionNumber)).size).toBe(2);
    expect(state.purchaseItems).toHaveLength(2);
    expect(state.purchaseItems.map(({ variantId }) => variantId).sort()).toEqual(
      [mandarinVariantId, otherVariantId].sort(),
    );
    expect(state.supplierProducts).toHaveLength(2);
    expect(state.supplierProducts.map(({ productId: linkedProductId }) => linkedProductId).sort()).toEqual(
      [productId, otherProductId].sort(),
    );
    expect(state.inventoryLevels).toHaveLength(3);
    expect(state.inventoryLevels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ locationId, variantId: mandarinVariantId, onHand: 9 }),
        expect.objectContaining({ locationId: otherLocationId, variantId: seafoodVariantId, onHand: 4 }),
        expect.objectContaining({ locationId, variantId: otherVariantId, onHand: 2 }),
      ]),
    );
    expect(state.inventoryMovements).toHaveLength(2);
    expect(state.inventoryMovements.map(({ referenceId }) => referenceId).sort()).toEqual(
      state.purchases.map(({ id }) => id).sort(),
    );
    expect(state.inventoryMovements.map(({ quantityDelta }) => quantityDelta).sort()).toEqual([2, 3]);
  }, 15_000);
});
