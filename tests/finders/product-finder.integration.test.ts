import pino from "pino";
import { describe, expect, it } from "vitest";
import { tables } from "../../src/db/schema.ts";
import { CollectionFinder } from "../../src/finders/collection-finder.ts";
import { ProductFinder } from "../../src/finders/product-finder.ts";
import { CreateProductService } from "../../src/services/catalog/create-product-service.ts";
import { generateId } from "../../src/utils/generate-id.ts";
import { prepareDatabase } from "../prepare-db.ts";

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  const collectionId = generateId({ model: "collection" });
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  await db.insert(tables.collection).values({ id: collectionId, merchantId, name: "Provisions", slug: "provisions" });
  const service = CreateProductService.create({
    db,
    collectionFinder: new CollectionFinder(),
    productFinder: new ProductFinder(),
    logger: pino({ enabled: false }),
    user: {
      id: "luffy",
      employeeId: "sanji",
      email: "sanji@strawhatpirates.example.com",
      accountType: "owner",
      merchantId,
    },
  });
  const result = await service.execute({
    name: "Sanji's provisions",
    price: "25.50",
    unitCost: "10.00",
    productType: "item",
    collectionId,
    sku: "SUNNY-01",
    barcode: "20001",
    imageUrl: "https://strawhatpirates.example.com/provisions.webp",
  });
  if (!result.success) {
    throw new Error("Fixture product creation failed.");
  }
  return { db, merchantId, otherMerchantId, collectionId, product: result.value };
}

describe("ProductFinder", () => {
  it("hydrates persisted option groups, variant options, and inventory values", async () => {
    const { db, merchantId, product } = await setup();
    const optionGroupId = generateId({ model: "optionGroup" });
    const optionId = generateId({ model: "option" });
    const locationId = generateId({ model: "location" });
    const inventoryId = generateId({ model: "inventoryLevel" });
    const variantId = product.variants[0].id;
    await db.insert(tables.optionGroup).values({ id: optionGroupId, merchantId, name: "Provision size" });
    await db
      .insert(tables.option)
      .values({ id: optionId, merchantId, optionGroupId, name: "Captain's portion", position: 2 });
    await db
      .insert(tables.productOptionGroup)
      .values({ id: generateId({ model: "productOptionGroup" }), merchantId, productId: product.id, optionGroupId });
    await db.insert(tables.variantOption).values({ id: generateId(), merchantId, variantId, optionId });
    await db.insert(tables.location).values({ id: locationId, merchantId, name: "Thousand Sunny" });
    await db.insert(tables.inventoryLevel).values({
      id: inventoryId,
      merchantId,
      variantId,
      locationId,
      onHand: 17,
      lowStockThreshold: 3,
      optimalStockLevel: 25,
    });

    const found = await new ProductFinder().find(db, { merchantId, id: product.id });

    expect(found?.optionGroups).toHaveLength(1);
    expect(found?.optionGroups[0]).toMatchObject({
      id: optionGroupId,
      name: "Provision size",
      options: [{ id: optionId, name: "Captain's portion", position: 2 }],
    });
    expect(found?.variants).toHaveLength(1);
    expect(found?.variants[0]).toMatchObject({
      id: variantId,
      options: [{ id: optionId, name: "Captain's portion", position: 2 }],
      inventoryLevels: [
        { id: inventoryId, variantId, locationId, onHand: 17, lowStockThreshold: 3, optimalStockLevel: 25 },
      ],
    });
  });

  it("loads the persisted product through a transaction with collection, variants, and image", async () => {
    const { db, merchantId, product } = await setup();
    const finder = new ProductFinder();

    const found = await db.transaction((transaction) => finder.find(transaction, { merchantId, id: product.id }));

    expect(found).toEqual(product);
    expect(found).toMatchObject({
      name: "Sanji's provisions",
      collection: { name: "Provisions" },
      imageUrl: "https://strawhatpirates.example.com/provisions.webp",
      variants: [expect.objectContaining({ sku: "SUNNY-01", barcode: "20001" })],
    });
  });

  it("combines product filters and does not match identifiers on separate variants", async () => {
    const { db, merchantId, product } = await setup();
    await db.insert(tables.variant).values({
      id: generateId({ model: "variant" }),
      merchantId,
      productId: product.id,
      name: "Sanji's second provision",
      price: "30.00",
      sku: "SUNNY-02",
      barcode: "20002",
    });
    const finder = new ProductFinder();

    const matching = { merchantId, id: product.id, sku: "SUNNY-01", barcode: "20001" };

    expect(await finder.exists(db, matching)).toBe(true);
    expect((await finder.find(db, matching))?.variants).toHaveLength(2);
    for (const criteria of [
      { ...matching, barcode: "20002" },
      { ...matching, id: "missing" },
      { ...matching, sku: "missing" },
      { merchantId, sku: "missing" },
      { merchantId, barcode: "missing" },
    ]) {
      expect(await finder.exists(db, criteria)).toBe(false);
      expect(await finder.find(db, criteria)).toBeNull();
    }
  });

  it("scopes id, SKU, barcode, and unfiltered product lookups to the merchant", async () => {
    const { db, merchantId, otherMerchantId, product } = await setup();
    const finder = new ProductFinder();

    for (const filter of [{ id: product.id }, { sku: "SUNNY-01" }, { barcode: "20001" }, {}]) {
      expect((await finder.find(db, { merchantId, ...filter }))?.id).toBe(product.id);
      expect(await finder.exists(db, { merchantId, ...filter })).toBe(true);
      expect(await finder.find(db, { merchantId: otherMerchantId, ...filter })).toBeNull();
      expect(await finder.exists(db, { merchantId: otherMerchantId, ...filter })).toBe(false);
    }
  });
});
