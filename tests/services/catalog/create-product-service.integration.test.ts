import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import type { Database } from "../../../src/db/index.ts";
import { tables } from "../../../src/db/schema.ts";
import { CollectionFinder } from "../../../src/finders/collection-finder.ts";
import { ProductFinder } from "../../../src/finders/product-finder.ts";
import { noopLogger } from "../../../src/infra/config.logger.ts";
import { ProductImageStore } from "../../../src/integrations/product-image-store.ts";
import {
  CreateProductRequest,
  CreateProductService,
} from "../../../src/services/catalog/products/create-product-service.ts";
import { EmployeeManagement } from "../../../src/services/employee-management.ts";
import { InventoryManagement } from "../../../src/services/inventory-management.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { err } from "../../../src/utils/result.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import {
  createRealtimeEventPublisherMock,
  trackCommittedBroadcasts,
} from "../../test-utils/realtime-publisher-mock.ts";
import { createRealtimeEnv } from "../../test-utils/realtime-env.ts";
import { EmployeeAuthorizationService } from "../../../src/services/employee-authorization-service.ts";

// Stands in for the bucket the product image store manages.
const MANAGED_STORAGE_URL = "https://storage.thousand-sunny.example.com/mipyme/product-images/";
const productImageStore = new ProductImageStore({
  env: {
    ...createRealtimeEnv(),
    BUCKET_STORAGE_ENDPOINT: "https://storage.thousand-sunny.example.com",
    BUCKET_STORAGE_PUBLIC_BASE_URL: "https://storage.thousand-sunny.example.com",
    BUCKET_STORAGE_BUCKET_NAME: "mipyme",
  },
  logger: noopLogger(),
});

const NOW = new Date("2026-11-19T15:00:00.000Z");

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  const thousandSunnyId = generateId({ model: "location" });
  const waterSevenId = generateId({ model: "location" });
  const polarTangId = generateId({ model: "location" });
  const sanjiId = generateId({ model: "employee" });
  const namiId = generateId({ model: "employee" });
  const robinId = generateId({ model: "employee" });
  const lawId = generateId({ model: "employee" });
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  await db.insert(tables.location).values([
    { id: thousandSunnyId, merchantId, name: "Thousand Sunny" },
    { id: waterSevenId, merchantId, name: "Water 7" },
    { id: polarTangId, merchantId: otherMerchantId, name: "Polar Tang" },
  ]);
  await db.insert(tables.employee).values([
    { id: sanjiId, merchantId, name: "Sanji", isOwner: true, status: "enabled", pin: "2222" },
    { id: namiId, merchantId, name: "Nami", status: "enabled", pin: "4821" },
    { id: robinId, merchantId, name: "Nico Robin", status: "disabled", pin: "1999" },
    { id: lawId, merchantId: otherMerchantId, name: "Trafalgar Law", isOwner: true, status: "enabled", pin: "7777" },
  ]);
  const { broadcast, publisher } = createRealtimeEventPublisherMock();
  const service = CreateProductService.create({
    publisher,
    db,
    collectionFinder: new CollectionFinder(),
    productFinder: new ProductFinder(new CollectionFinder()),
    productImageStore,
    employeeManagement: new EmployeeManagement(EmployeeAuthorizationService.create({ db })),
    inventoryManagement: new InventoryManagement(),
    logger: pino({ enabled: false }),
    user: {
      id: "luffy",
      employeeId: sanjiId,
      email: "sanji@strawhatpirates.example.com",
      accountType: "owner",
      merchantId,
    },
  });
  return {
    broadcast,
    db,
    service,
    merchantId,
    thousandSunnyId,
    waterSevenId,
    polarTangId,
    sanjiId,
    namiId,
    robinId,
    lawId,
  };
}

async function readInventoryState(db: Database) {
  return {
    products: await db.select().from(tables.product).orderBy(tables.product.id),
    variants: await db.select().from(tables.variant).orderBy(tables.variant.id),
    inventoryLevels: await db.select().from(tables.inventoryLevel).orderBy(tables.inventoryLevel.id),
    inventoryMovements: await db.select().from(tables.inventoryMovement).orderBy(tables.inventoryMovement.id),
  };
}

async function readLevelsByLocation(db: Database, variantId: string) {
  const levels = await db.select().from(tables.inventoryLevel).where(eq(tables.inventoryLevel.variantId, variantId));
  return new Map(levels.map((level) => [level.locationId, level]));
}

afterEach(() => vi.restoreAllMocks());

describe("CreateProductService", () => {
  it.each([
    {
      scenario: "explicit item without cost",
      productType: "item",
      unitCost: undefined,
      message: "Provide a unit cost for items.",
    },
    {
      scenario: "default item without cost",
      productType: undefined,
      unitCost: undefined,
      message: "Provide a unit cost for items.",
    },
    {
      scenario: "item with zero cost",
      productType: "item",
      unitCost: "0.00",
      message: "Provide a unit cost greater than zero for items.",
    },
  ])("rejects $scenario without creating product records", async ({ productType, unitCost, message }) => {
    const { db, service } = await setup();
    const request = CreateProductRequest.parse({ name: "Sanji's provisions", price: "9.99", productType, unitCost });

    const result = await service.execute(request);

    expect(result).toEqual(
      err({
        code: codes.validationError,
        message,
        details: [],
      }),
    );
    expect(await db.select().from(tables.product)).toEqual([]);
    expect(await db.select().from(tables.variant)).toEqual([]);
    expect(await db.select().from(tables.inventoryLevel)).toEqual([]);
    expect(await db.select().from(tables.productImage)).toEqual([]);
  });

  it("rejects an image from managed storage without creating product records or broadcasting", async () => {
    const { broadcast, db, service } = await setup();

    const result = await service.execute({
      name: "Sanji's provisions",
      productType: "item",
      price: "9.99",
      unitCost: "5.00",
      imageUrl: `${MANAGED_STORAGE_URL}uploads/provisions.webp`,
    });

    expect(result).toEqual(
      err({
        code: codes.validationError,
        message: "Verify a product image upload before using an image from managed storage.",
        details: [],
      }),
    );
    expect(await db.select().from(tables.product)).toEqual([]);
    expect(await db.select().from(tables.variant)).toEqual([]);
    expect(await db.select().from(tables.productImage)).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("rejects an item priced below unit cost without creating product records", async () => {
    const { db, service } = await setup();

    const result = await service.execute({
      name: "Sanji's provisions",
      productType: "item",
      price: "9.99",
      unitCost: "10.00",
      imageUrl: "https://strawhatpirates.example.com/provisions.webp",
    });

    expect(result).toEqual(
      err({
        code: codes.priceBelowUnitCost,
        message: "The price must be equal to or greater than the unit cost.",
        details: [],
      }),
    );
    expect(await db.select().from(tables.product)).toEqual([]);
    expect(await db.select().from(tables.variant)).toEqual([]);
    expect(await db.select().from(tables.inventoryLevel)).toEqual([]);
    expect(await db.select().from(tables.productImage)).toEqual([]);
  });

  it.each([
    { scenario: "equal to", price: "10", unitCost: "10.00", storedPrice: "10.00", storedCost: "10.00" },
    { scenario: "above", price: "10.00", unitCost: "9.99", storedPrice: "10.00", storedCost: "9.99" },
  ])("persists an item priced $scenario unit cost", async ({ price, unitCost, storedPrice, storedCost }) => {
    const { broadcast, merchantId, db, service } = await setup();

    const committedAtPublish = trackCommittedBroadcasts(db, broadcast);

    const result = await service.execute({ name: "Sanji's provisions", productType: "item", price, unitCost });

    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "product", snapshot: result.value },
    });
    expect(committedAtPublish).toEqual([true]);

    expect(result.success).toBe(true);
    const [product] = await db.select().from(tables.product);
    expect(product).toMatchObject({ id: result.value?.id, price: storedPrice, unitCost: storedCost });
  });

  it.each(["10.00", "0.00", undefined])(
    "creates a service with unit cost %s and persists zero unit cost",
    async (unitCost) => {
      const { broadcast, merchantId, db, service } = await setup();

      const request = CreateProductRequest.parse({
        name: "Chopper's consultation",
        productType: "service",
        price: "9.99",
        unitCost,
      });

      const committedAtPublish = trackCommittedBroadcasts(db, broadcast);

      const result = await service.execute(request);

      expect(broadcast).toHaveBeenCalledExactlyOnceWith({
        merchantId,
        resource: { type: "product", snapshot: result.value },
      });
      expect(committedAtPublish).toEqual([true]);

      expect(result.success).toBe(true);
      const [product] = await db.select().from(tables.product);
      expect(product).toMatchObject({ id: result.value?.id, price: "9.99", unitCost: "0.00", type: "service" });
    },
  );

  it("does not publish or persist a service product when variant storage fails", async () => {
    const { db, service, broadcast } = await setup();
    await db.execute(
      sql`CREATE TRIGGER reject_realtime_product_variant BEFORE INSERT ON variants FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Variant storage unavailable'`,
    );

    try {
      const operation = service.execute({
        name: "Chopper's consultation",
        productType: "service",
        price: "100.00",
      });

      await expect(operation).rejects.toMatchObject({ cause: { sqlState: "45000" } });
      expect(broadcast).not.toHaveBeenCalled();
      expect(await db.select().from(tables.product)).toEqual([]);
    } finally {
      await db.execute(sql`DROP TRIGGER reject_realtime_product_variant`);
    }
  });
});

describe("CreateProductService inventory levels", () => {
  it("records initial stock at a listed location and initializes unlisted locations empty", async () => {
    const { db, service, merchantId, thousandSunnyId, waterSevenId, sanjiId } = await setup();
    vi.spyOn(Date, "now").mockReturnValue(NOW.getTime());

    const result = await service.execute({
      name: "Sanji's provisions",
      productType: "item",
      price: "25.00",
      unitCost: "10.00",
      inventoryLevels: [{ locationId: thousandSunnyId, onHand: 12, lowStockThreshold: 3, optimalStockLevel: 20 }],
    });

    expect(result.success).toBe(true);
    expect(result.value?.status).toBe("active");
    const [product] = await db.select().from(tables.product);
    const [variant] = await db.select().from(tables.variant);
    expect(product.status).toBe("active");
    expect(product.lastRestockAt).toEqual(NOW);
    const levels = await readLevelsByLocation(db, variant.id);
    expect(levels.size).toBe(2);
    const stockedLevel = levels.get(thousandSunnyId);
    expect(stockedLevel).toMatchObject({
      merchantId,
      onHand: 12,
      lowStockThreshold: 3,
      optimalStockLevel: 20,
      lastRestockAt: NOW,
      lastInventoryAdjustmentAt: NOW,
      lastSoldAt: null,
    });
    expect(levels.get(waterSevenId)).toMatchObject({
      onHand: 0,
      lowStockThreshold: 0,
      optimalStockLevel: 0,
      lastRestockAt: null,
      lastInventoryAdjustmentAt: null,
    });
    expect(await db.select().from(tables.inventoryMovement)).toEqual([
      expect.objectContaining({
        merchantId,
        inventoryLevelId: stockedLevel?.id,
        reason: "initial_stock",
        fromState: "none",
        toState: "in_stock",
        quantityDelta: 12,
        unitCost: "10.00",
        referenceId: null,
        createdById: sanjiId,
        occurredAt: NOW,
      }),
    ]);
    const stockStatuses = result.value?.variants[0].inventoryLevels.map(({ locationId, stockStatus }) => ({
      locationId,
      stockStatus,
    }));
    expect(stockStatuses).toEqual(
      expect.arrayContaining([
        { locationId: thousandSunnyId, stockStatus: "in_stock" },
        { locationId: waterSevenId, stockStatus: "not_stocked" },
      ]),
    );
  });

  it("applies thresholds without stock, including an explicit zero on hand, without recording movements", async () => {
    const { db, service, thousandSunnyId, waterSevenId } = await setup();

    const result = await service.execute({
      name: "Sanji's provisions",
      productType: "item",
      price: "25.00",
      unitCost: "10.00",
      inventoryLevels: [
        { locationId: thousandSunnyId, lowStockThreshold: 5, optimalStockLevel: 0 },
        { locationId: waterSevenId, onHand: 0, lowStockThreshold: 9, optimalStockLevel: 10 },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.value?.status).toBe("draft");
    const [product] = await db.select().from(tables.product);
    const [variant] = await db.select().from(tables.variant);
    expect(product.status).toBe("draft");
    expect(product.lastRestockAt).toBeNull();
    const levels = await readLevelsByLocation(db, variant.id);
    expect(levels.get(thousandSunnyId)).toMatchObject({
      onHand: 0,
      lowStockThreshold: 5,
      optimalStockLevel: 0,
      lastRestockAt: null,
      lastInventoryAdjustmentAt: null,
    });
    expect(levels.get(waterSevenId)).toMatchObject({
      onHand: 0,
      lowStockThreshold: 9,
      optimalStockLevel: 10,
      lastRestockAt: null,
      lastInventoryAdjustmentAt: null,
    });
    expect(await db.select().from(tables.inventoryMovement)).toEqual([]);
  });

  it("credits the initial stock to the requested employee", async () => {
    const { db, service, waterSevenId, namiId } = await setup();

    const result = await service.execute({
      name: "Nami's mandarins",
      productType: "item",
      price: "5.00",
      unitCost: "2.00",
      createdById: namiId,
      inventoryLevels: [{ locationId: waterSevenId, onHand: 30 }],
    });

    expect(result.success).toBe(true);
    expect(await db.select().from(tables.inventoryMovement)).toEqual([
      expect.objectContaining({ createdById: namiId, quantityDelta: 30, unitCost: "2.00" }),
    ]);
  });

  it.each([
    {
      scenario: "a duplicate location",
      inventoryLevels: (ids: LocationIds) => [
        { locationId: ids.thousandSunnyId, onHand: 1 },
        { locationId: ids.thousandSunnyId, lowStockThreshold: 2 },
      ],
      code: codes.validationError,
    },
    {
      scenario: "a location of another merchant",
      inventoryLevels: (ids: LocationIds) => [{ locationId: ids.polarTangId, onHand: 1 }],
      code: codes.resourceNotFound,
    },
    {
      scenario: "a missing location",
      inventoryLevels: () => [{ locationId: generateId({ model: "location" }), onHand: 1 }],
      code: codes.resourceNotFound,
    },
    {
      scenario: "a low stock threshold equal to the optimal stock level",
      inventoryLevels: (ids: LocationIds) => [
        { locationId: ids.waterSevenId, lowStockThreshold: 10, optimalStockLevel: 10 },
      ],
      code: codes.validationError,
    },
    {
      scenario: "a low stock threshold above the optimal stock level",
      inventoryLevels: (ids: LocationIds) => [
        { locationId: ids.thousandSunnyId, onHand: 4 },
        { locationId: ids.waterSevenId, lowStockThreshold: 11, optimalStockLevel: 10 },
      ],
      code: codes.validationError,
    },
  ])("rejects $scenario without creating product records", async ({ inventoryLevels, code }) => {
    const { broadcast, db, service, ...ids } = await setup();

    const result = await service.execute({
      name: "Sanji's provisions",
      productType: "item",
      price: "25.00",
      unitCost: "10.00",
      inventoryLevels: inventoryLevels(ids),
    });

    expect(result).toMatchObject({ success: false, error: { code } });
    expect(await readInventoryState(db)).toEqual({
      products: [],
      variants: [],
      inventoryLevels: [],
      inventoryMovements: [],
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it.each([
    { scenario: "missing", employee: () => generateId({ model: "employee" }), code: codes.resourceNotFound },
    { scenario: "disabled", employee: (ids: EmployeeIds) => ids.robinId, code: codes.forbiddenError },
    { scenario: "other merchant's", employee: (ids: EmployeeIds) => ids.lawId, code: codes.resourceNotFound },
  ])("rejects a $scenario credited employee without creating product records", async ({ employee, code }) => {
    const { broadcast, db, service, thousandSunnyId, ...ids } = await setup();

    const result = await service.execute({
      name: "Sanji's provisions",
      productType: "item",
      price: "25.00",
      unitCost: "10.00",
      createdById: employee(ids),
      inventoryLevels: [{ locationId: thousandSunnyId, onHand: 12 }],
    });

    expect(result).toMatchObject({ success: false, error: { code } });
    expect(await readInventoryState(db)).toEqual({
      products: [],
      variants: [],
      inventoryLevels: [],
      inventoryMovements: [],
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("ignores inventory levels for a service, including locations the merchant does not own", async () => {
    const { db, service, polarTangId } = await setup();

    const result = await service.execute({
      name: "Chopper's consultation",
      productType: "service",
      price: "50.00",
      inventoryLevels: [{ locationId: polarTangId, onHand: 12, lowStockThreshold: 3, optimalStockLevel: 20 }],
    });

    expect(result.success).toBe(true);
    const state = await readInventoryState(db);
    expect(state.products).toHaveLength(1);
    expect(state.products[0].lastRestockAt).toBeNull();
    expect(state.inventoryLevels).toEqual([]);
    expect(state.inventoryMovements).toEqual([]);
  });

  it("rejects a disabled credited employee for a service without creating product records", async () => {
    const { broadcast, db, service, robinId } = await setup();

    const result = await service.execute({
      name: "Chopper's consultation",
      productType: "service",
      price: "50.00",
      createdById: robinId,
    });

    expect(result).toMatchObject({ success: false, error: { code: codes.forbiddenError } });
    expect(await readInventoryState(db)).toEqual({
      products: [],
      variants: [],
      inventoryLevels: [],
      inventoryMovements: [],
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("rolls back the product, variant, and levels when the initial stock movement cannot be stored", async () => {
    const { broadcast, db, service, thousandSunnyId } = await setup();
    await db.execute(
      sql`CREATE TRIGGER reject_initial_stock BEFORE INSERT ON inventory_movements FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Movement storage unavailable'`,
    );

    try {
      const operation = service.execute({
        name: "Sanji's provisions",
        productType: "item",
        price: "25.00",
        unitCost: "10.00",
        inventoryLevels: [{ locationId: thousandSunnyId, onHand: 12 }],
      });

      await expect(operation).rejects.toMatchObject({ cause: { sqlState: "45000" } });
      expect(await readInventoryState(db)).toEqual({
        products: [],
        variants: [],
        inventoryLevels: [],
        inventoryMovements: [],
      });
      expect(broadcast).not.toHaveBeenCalled();
    } finally {
      await db.execute(sql`DROP TRIGGER reject_initial_stock`);
    }
  });

  it.each(
    (["onHand", "lowStockThreshold", "optimalStockLevel"] as const).flatMap((field) => [
      { field, value: 0, accepted: true },
      { field, value: 999_999_999, accepted: true },
      { field, value: 1_000_000_000, accepted: false },
      { field, value: -1, accepted: false },
      { field, value: 1.5, accepted: false },
    ]),
  )("validates $field $value against the stock quantity bounds", ({ field, value, accepted }) => {
    const locationId = generateId({ model: "location" });

    const parsed = CreateProductRequest.safeParse({
      name: "Sanji's provisions",
      price: "25.00",
      unitCost: "10.00",
      inventoryLevels: [{ locationId, [field]: value }],
    });

    expect(parsed.success).toBe(accepted);
  });
});

type LocationIds = { thousandSunnyId: string; waterSevenId: string; polarTangId: string };
type EmployeeIds = { robinId: string; lawId: string };
