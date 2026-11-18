import { sql } from "drizzle-orm";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import { tables } from "../../../src/db/schema.ts";
import { CollectionFinder } from "../../../src/finders/collection-finder.ts";
import { ProductFinder } from "../../../src/finders/product-finder.ts";
import {
  CreateProductRequest,
  CreateProductService,
} from "../../../src/services/catalog/products/create-product-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { err } from "../../../src/utils/result.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import {
  createRealtimeEventPublisherMock,
  trackCommittedBroadcasts,
} from "../../test-utils/realtime-publisher-mock.ts";

// Stands in for the bucket the product image store manages.
const MANAGED_STORAGE_URL = "https://storage.thousand-sunny.example.com/mipyme/product-images/";
const productImageStore = { isManagedUrl: (url: string) => url.startsWith(MANAGED_STORAGE_URL) };

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  await db.insert(tables.merchant).values({ id: merchantId, name: "Straw Hat Pirates", country: "ni" });
  await db.insert(tables.location).values({
    id: generateId({ model: "location" }),
    merchantId,
    name: "Thousand Sunny",
  });
  const { broadcast, publisher } = createRealtimeEventPublisherMock();
  const service = CreateProductService.create({
    publisher,
    db,
    collectionFinder: new CollectionFinder(),
    productFinder: new ProductFinder(),
    productImageStore,
    logger: pino({ enabled: false }),
    user: {
      id: "luffy",
      employeeId: "sanji",
      email: "sanji@strawhatpirates.example.com",
      accountType: "owner",
      merchantId,
    },
  });
  return { broadcast, db, service, merchantId };
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
