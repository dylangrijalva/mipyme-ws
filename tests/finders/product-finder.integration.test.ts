import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Product } from "../../src/contracts/product.ts";
import { tables } from "../../src/db/schema.ts";
import { ProductFinder } from "../../src/finders/product-finder.ts";
import { generateId } from "../../src/utils/generate-id.ts";
import { prepareDatabase } from "../prepare-db.ts";

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  const collectionId = generateId({ model: "collection" });
  const productId = generateId({ model: "product" });
  const variantId = "var_00000000000000000001";
  const timestamp = new Date("2026-01-01T00:00:00Z");
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  await db.insert(tables.collection).values({ id: collectionId, merchantId, name: "Provisions", slug: "provisions" });
  await db.insert(tables.product).values({
    id: productId,
    merchantId,
    name: "Sanji's provisions",
    slug: "sanjis-provisions",
    price: "25.50",
    unitCost: "10.00",
    type: "item",
    status: "active",
    collectionId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(tables.variant).values({
    id: variantId,
    merchantId,
    productId,
    name: "Sanji's provisions",
    price: "25.50",
    sku: "SUNNY-01",
    barcode: "20001",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(tables.productImage).values({
    id: generateId({ model: "img" }),
    merchantId,
    productId,
    source: "remote",
    status: "available",
    remoteUrl: "https://strawhatpirates.example.com/provisions.webp",
    activatedAt: timestamp,
  });
  return { db, merchantId, otherMerchantId, collectionId, productId, variantId, timestamp };
}

describe("ProductFinder", () => {
  it("paginates hydrated products from a transaction in id order without including foreign products", async () => {
    const db = await prepareDatabase();
    const merchantId = generateId({ model: "merchant" });
    const otherMerchantId = generateId({ model: "merchant" });
    const firstId = "prod_0000000000000000001";
    const lastId = "prod_0000000000000000003";
    const finalId = "prod_0000000000000000005";
    const variantId = generateId({ model: "variant" });
    await db.insert(tables.merchant).values([
      { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
      { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
    ]);
    await db.insert(tables.product).values({
      id: "prod_0000000000000000002",
      merchantId: otherMerchantId,
      name: "Polar Tang provisions",
      slug: "polar-tang",
      price: "10.00",
      unitCost: "5.00",
      type: "item",
      status: "active",
    });
    const finder = new ProductFinder();

    const pages = await db.transaction(async (transaction) => {
      await transaction.insert(tables.product).values([
        {
          id: finalId,
          merchantId,
          name: "Sanji's provisions",
          slug: "provisions",
          price: "25.50",
          unitCost: "10.00",
          type: "item",
          status: "active",
        },
        {
          id: lastId,
          merchantId,
          name: "Nami's mandarins",
          slug: "mandarins",
          price: "15.00",
          unitCost: "5.00",
          type: "item",
          status: "active",
        },
        {
          id: firstId,
          merchantId,
          name: "Sanji's seafood",
          slug: "seafood",
          price: "20.00",
          unitCost: "8.00",
          type: "item",
          status: "active",
        },
      ]);
      await transaction.insert(tables.variant).values({
        id: variantId,
        merchantId,
        productId: finalId,
        name: "Captain's portion",
        price: "25.50",
        sku: "SUNNY-01",
      });
      return {
        first: await finder.paginate(transaction, { merchantId, limit: 2 }),
        final: await finder.paginate(transaction, { merchantId, limit: 1, cursor: lastId }),
        empty: await finder.paginate(transaction, { merchantId, limit: 2, cursor: finalId }),
      };
    });

    expect(pages.first.results.map((entry) => entry.id)).toEqual([firstId, lastId]);
    expect(pages.first).toMatchObject({
      hasMore: true,
      nextCursor: lastId,
      results: [
        { name: "Sanji's seafood", collection: null, variants: [], optionGroups: [], imageUrl: null },
        { name: "Nami's mandarins", collection: null, variants: [], optionGroups: [], imageUrl: null },
      ],
    });
    expect(pages.final.results.map((entry) => entry.id)).toEqual([finalId]);
    expect(pages.final).toMatchObject({
      results: [{ id: finalId, name: "Sanji's provisions", variants: [{ id: variantId, sku: "SUNNY-01" }] }],
      hasMore: false,
      nextCursor: null,
    });
    expect(pages.empty).toEqual({ results: [], hasMore: false, nextCursor: null });
  });

  it("hydrates ordered options and keeps each product's variants and each variant's inventory separate", async () => {
    const { db, merchantId, productId, collectionId, variantId, timestamp } = await setup();
    const optionGroupId = generateId({ model: "optionGroup" });
    const firstOptionId = "opt_00000000000000000001";
    const secondOptionId = "opt_00000000000000000002";
    const lastOptionId = "opt_00000000000000000003";
    const otherOptionId = generateId({ model: "option" });
    const otherGroupId = generateId({ model: "optionGroup" });
    const secondVariantId = "var_00000000000000000002";
    const otherProductId = generateId({ model: "product" });
    const otherVariantId = generateId({ model: "variant" });
    const locationId = generateId({ model: "location" });
    const otherLocationId = generateId({ model: "location" });
    const firstInventoryId = "inv_00000000000000000001";
    const lastInventoryId = "inv_00000000000000000003";
    await db.insert(tables.product).values({
      id: otherProductId,
      merchantId,
      name: "Chopper's medicine",
      slug: "medicine",
      price: "12.00",
      unitCost: "4.00",
    });
    await db.insert(tables.variant).values([
      { id: otherVariantId, merchantId, productId: otherProductId, name: "Medicine", price: "12.00" },
      { id: secondVariantId, merchantId, productId, name: "Crew portion", price: "20.00" },
    ]);
    await db.insert(tables.optionGroup).values([
      { id: otherGroupId, merchantId, name: "Medicine size" },
      { id: optionGroupId, merchantId, name: "Provision size" },
    ]);
    await db.insert(tables.option).values([
      { id: lastOptionId, merchantId, optionGroupId, name: "Captain's portion", position: 2 },
      { id: secondOptionId, merchantId, optionGroupId, name: "Cook's portion", position: 1 },
      { id: otherOptionId, merchantId, optionGroupId: otherGroupId, name: "Medicine bottle", position: 0 },
      { id: firstOptionId, merchantId, optionGroupId, name: "Crew portion", position: 1 },
    ]);
    await db.insert(tables.productOptionGroup).values([
      {
        id: generateId({ model: "productOptionGroup" }),
        merchantId,
        productId: otherProductId,
        optionGroupId: otherGroupId,
      },
      { id: generateId({ model: "productOptionGroup" }), merchantId, productId, optionGroupId },
    ]);
    await db.insert(tables.variantOption).values([
      { id: generateId(), merchantId, variantId, optionId: lastOptionId },
      { id: generateId(), merchantId, variantId: secondVariantId, optionId: lastOptionId },
      { id: generateId(), merchantId, variantId, optionId: secondOptionId },
      { id: generateId(), merchantId, variantId: otherVariantId, optionId: otherOptionId },
      { id: generateId(), merchantId, variantId, optionId: firstOptionId },
    ]);
    await db.insert(tables.location).values([
      { id: locationId, merchantId, name: "Thousand Sunny" },
      { id: otherLocationId, merchantId, name: "Water 7" },
    ]);
    await db.insert(tables.inventoryLevel).values([
      {
        id: lastInventoryId,
        merchantId,
        variantId,
        locationId: otherLocationId,
        onHand: 0,
        lowStockThreshold: 0,
        optimalStockLevel: 0,
      },
      { id: "inv_00000000000000000002", merchantId, variantId: secondVariantId, locationId, onHand: 99 },
      {
        id: firstInventoryId,
        merchantId,
        variantId,
        locationId,
        onHand: 17,
        lowStockThreshold: 3,
        optimalStockLevel: 25,
        lastSoldAt: new Date("2026-01-03T00:00:00Z"),
        lastRestockAt: new Date("2026-01-02T00:00:00Z"),
        lastInventoryAdjustmentAt: new Date("2026-01-03T00:00:00Z"),
      },
    ]);

    const found = await new ProductFinder().find(db, { merchantId, id: productId });

    expect(found).toEqual({
      id: productId,
      name: "Sanji's provisions",
      slug: "sanjis-provisions",
      price: "25.50",
      unitCost: "10.00",
      productType: "item",
      status: "active",
      collection: { id: collectionId, name: "Provisions" },
      imageUrl: "https://strawhatpirates.example.com/provisions.webp",
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
      optionGroups: expect.any(Array),
      variants: expect.any(Array),
    });
    expect(found?.variants[0]).toEqual({
      id: variantId,
      name: "Sanji's provisions",
      price: "25.50",
      sku: "SUNNY-01",
      barcode: "20001",
      createdAt: timestamp,
      updatedAt: timestamp,
      options: expect.any(Array),
      inventoryLevels: expect.any(Array),
    });
    expect(found?.optionGroups).toHaveLength(1);
    expect(found?.optionGroups[0]).toMatchObject({ id: optionGroupId, name: "Provision size" });
    expect(found?.optionGroups[0].options.map((option) => option.id)).toEqual([
      firstOptionId,
      secondOptionId,
      lastOptionId,
    ]);
    expect(found?.variants.map((variant) => variant.id)).toEqual([variantId, secondVariantId]);
    expect(found?.variants[0].options.map((option) => option.id)).toEqual([
      firstOptionId,
      secondOptionId,
      lastOptionId,
    ]);
    expect(found?.variants[1].options.map((option) => option.id)).toEqual([lastOptionId]);
    expect(found?.variants[0].inventoryLevels).toEqual([
      {
        id: firstInventoryId,
        variantId,
        locationId,
        onHand: 17,
        lowStockThreshold: 3,
        optimalStockLevel: 25,
        lastSoldAt: new Date("2026-01-03T00:00:00Z"),
        lastRestockAt: new Date("2026-01-02T00:00:00Z"),
        lastInventoryAdjustmentAt: new Date("2026-01-03T00:00:00Z"),
        stockStatus: "in_stock",
      },
      {
        id: lastInventoryId,
        variantId,
        locationId: otherLocationId,
        onHand: 0,
        lowStockThreshold: 0,
        optimalStockLevel: 0,
        lastSoldAt: null,
        lastRestockAt: null,
        lastInventoryAdjustmentAt: null,
        stockStatus: "not_stocked",
      },
    ]);
    expect(found?.variants[1].inventoryLevels).toEqual([
      {
        id: "inv_00000000000000000002",
        variantId: secondVariantId,
        locationId,
        onHand: 99,
        lowStockThreshold: 0,
        optimalStockLevel: 0,
        lastSoldAt: null,
        lastRestockAt: null,
        lastInventoryAdjustmentAt: null,
        stockStatus: "in_stock",
      },
    ]);
  });

  it("returns the computed stock status of each inventory level from find, paginate, and sync lookups", async () => {
    const { db, merchantId, productId, variantId } = await setup();
    const inStockLocationId = "loc_00000000000000000001";
    const lowStockLocationId = "loc_00000000000000000002";
    const outOfStockLocationId = "loc_00000000000000000003";
    const notStockedLocationId = "loc_00000000000000000004";
    const restockedAt = new Date("2026-01-02T00:00:00Z");
    await db.insert(tables.location).values([
      { id: inStockLocationId, merchantId, name: "Thousand Sunny" },
      { id: lowStockLocationId, merchantId, name: "Water 7" },
      { id: outOfStockLocationId, merchantId, name: "Sabaody" },
      { id: notStockedLocationId, merchantId, name: "Fish-Man Island" },
    ]);
    await db.insert(tables.inventoryLevel).values([
      {
        id: "inv_00000000000000000001",
        merchantId,
        variantId,
        locationId: inStockLocationId,
        onHand: 6,
        lowStockThreshold: 5,
        lastRestockAt: restockedAt,
      },
      {
        id: "inv_00000000000000000002",
        merchantId,
        variantId,
        locationId: lowStockLocationId,
        onHand: 5,
        lowStockThreshold: 5,
        lastRestockAt: restockedAt,
      },
      {
        id: "inv_00000000000000000003",
        merchantId,
        variantId,
        locationId: outOfStockLocationId,
        onHand: 0,
        lowStockThreshold: 5,
        lastRestockAt: restockedAt,
      },
      {
        id: "inv_00000000000000000004",
        merchantId,
        variantId,
        locationId: notStockedLocationId,
        onHand: 0,
        lowStockThreshold: 5,
      },
    ]);
    const finder = new ProductFinder();
    const expectedStockStatuses = [
      { locationId: inStockLocationId, stockStatus: "in_stock" },
      { locationId: lowStockLocationId, stockStatus: "low_stock" },
      { locationId: outOfStockLocationId, stockStatus: "out_of_stock" },
      { locationId: notStockedLocationId, stockStatus: "not_stocked" },
    ];

    const found = await finder.find(db, { merchantId, id: productId });
    const page = await finder.paginate(db, { merchantId, limit: 10 });
    const synced = await finder.findForSync(db, { merchantId, previousSyncedAt: null, currentSyncedAt: new Date() });

    const stockStatusesOf = (product: Product | null | undefined) =>
      product?.variants[0]?.inventoryLevels.map(({ locationId, stockStatus }) => ({ locationId, stockStatus }));
    expect(stockStatusesOf(found)).toEqual(expectedStockStatuses);
    expect(page.results.map((product) => product.id)).toEqual([productId]);
    expect(stockStatusesOf(page.results[0])).toEqual(expectedStockStatuses);
    expect(synced.map((product) => product.id)).toEqual([productId]);
    expect(stockStatusesOf(synced[0])).toEqual(expectedStockStatuses);
  });

  it("combines product filters and does not match identifiers on separate variants", async () => {
    const { db, merchantId, productId } = await setup();
    const otherProductId = generateId({ model: "product" });
    await db.insert(tables.product).values({
      id: otherProductId,
      merchantId,
      name: "Chopper's medicine",
      slug: "medicine",
      price: "12.00",
      unitCost: "4.00",
    });
    await db.insert(tables.variant).values({
      id: generateId({ model: "variant" }),
      merchantId,
      productId,
      name: "Sanji's second provision",
      price: "30.00",
      sku: "SUNNY-02",
      barcode: "20002",
    });
    const finder = new ProductFinder();

    const matching = { merchantId, id: productId, sku: "SUNNY-01", barcode: "20001" };

    expect(await finder.exists(db, matching)).toBe(true);
    expect((await finder.find(db, matching))?.variants).toHaveLength(2);
    for (const criteria of [
      { ...matching, barcode: "20002" },
      { ...matching, id: "missing" },
      { ...matching, sku: "missing" },
      { merchantId, sku: "missing" },
      { merchantId, barcode: "missing" },
      { merchantId, id: otherProductId, sku: "SUNNY-01" },
      { merchantId, id: otherProductId, barcode: "20001" },
    ]) {
      expect(await finder.exists(db, criteria)).toBe(false);
      expect(await finder.find(db, criteria)).toBeNull();
    }
  });

  it("selects the latest eligible image by activation and id and returns null when none remain", async () => {
    const { db, merchantId, productId } = await setup();
    const otherProductId = generateId({ model: "product" });
    await db.insert(tables.product).values({
      id: otherProductId,
      merchantId,
      name: "Chopper's medicine",
      slug: "medicine",
      price: "12.00",
      unitCost: "4.00",
    });
    const activatedAt = new Date("2026-01-02T00:00:00Z");
    const later = new Date("2026-01-03T00:00:00Z");
    await db.insert(tables.productImage).values([
      {
        id: "img_00000000000000000002",
        merchantId,
        productId,
        source: "remote",
        status: "available",
        activatedAt,
        remoteUrl: "https://strawhatpirates.example.com/latest.webp",
      },
      {
        id: "img_00000000000000000001",
        merchantId,
        productId,
        source: "remote",
        status: "available",
        activatedAt,
        remoteUrl: "https://strawhatpirates.example.com/tied.webp",
      },
      {
        id: "img_00000000000000000003",
        merchantId,
        productId,
        source: "remote",
        status: "pending",
        activatedAt: later,
        remoteUrl: "https://strawhatpirates.example.com/pending.webp",
      },
      {
        id: "img_00000000000000000004",
        merchantId,
        productId,
        source: "remote",
        status: "available",
        activatedAt: later,
        archivedAt: later,
        remoteUrl: "https://strawhatpirates.example.com/archived.webp",
      },
      {
        id: "img_00000000000000000005",
        merchantId,
        productId: otherProductId,
        source: "remote",
        status: "available",
        activatedAt: later,
        remoteUrl: "https://strawhatpirates.example.com/medicine.webp",
      },
    ]);

    const found = await new ProductFinder().find(db, { merchantId, id: productId });

    expect(found?.imageUrl).toBe("https://strawhatpirates.example.com/latest.webp");

    await db
      .update(tables.productImage)
      .set({ archivedAt: later })
      .where(and(eq(tables.productImage.productId, productId), eq(tables.productImage.status, "available")));

    const withoutImage = await new ProductFinder().find(db, { merchantId, id: productId });

    expect(withoutImage?.imageUrl).toBeNull();
  });

  it("scopes id, SKU, barcode, and unfiltered product lookups to the merchant", async () => {
    const { db, merchantId, otherMerchantId, productId } = await setup();
    const finder = new ProductFinder();

    for (const filter of [{ id: productId }, { sku: "SUNNY-01" }, { barcode: "20001" }, {}]) {
      expect((await finder.find(db, { merchantId, ...filter }))?.id).toBe(productId);
      expect(await finder.exists(db, { merchantId, ...filter })).toBe(true);
      expect(await finder.find(db, { merchantId: otherMerchantId, ...filter })).toBeNull();
      expect(await finder.exists(db, { merchantId: otherMerchantId, ...filter })).toBe(false);
    }
  });
});
