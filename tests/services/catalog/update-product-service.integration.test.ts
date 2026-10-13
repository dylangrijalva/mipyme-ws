import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import type { Database } from "../../../src/db/index.ts";
import { tables } from "../../../src/db/schema.ts";
import { CollectionFinder } from "../../../src/finders/collection-finder.ts";
import { ProductFinder } from "../../../src/finders/product-finder.ts";
import { UpdateProductService } from "../../../src/services/catalog/products/update-product-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import { waitForBlockedUpdate } from "../../test-utils/wait-for-blocked-update.ts";

async function readState(db: Database) {
  return {
    products: await db.select().from(tables.product).orderBy(tables.product.id),
    variants: await db.select().from(tables.variant).orderBy(tables.variant.id),
    images: await db.select().from(tables.productImage).orderBy(tables.productImage.id),
    inventory: await db.select().from(tables.inventoryLevel).orderBy(tables.inventoryLevel.id),
  };
}

async function setup(productType: "item" | "service" = "service") {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  const collectionId = generateId({ model: "collection" });
  const replacementCollectionId = generateId({ model: "collection" });
  const otherCollectionId = generateId({ model: "collection" });
  const productId = generateId({ model: "product" });
  const neighborProductId = generateId({ model: "product" });
  const otherProductId = generateId({ model: "product" });
  const timestamp = new Date("2026-01-01T00:00:00Z");

  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  await db.insert(tables.collection).values([
    { id: collectionId, merchantId, name: "Chopper's clinic", slug: "choppers-clinic" },
    { id: replacementCollectionId, merchantId, name: "Thousand Sunny", slug: "thousand-sunny" },
    { id: otherCollectionId, merchantId: otherMerchantId, name: "Polar Tang", slug: "polar-tang" },
  ]);
  const products = [
    { id: productId, merchantId, collectionId, name: "Chopper's consultation" },
    { id: neighborProductId, merchantId, collectionId, name: "Sanji's cooking lesson" },
    { id: otherProductId, merchantId: otherMerchantId, collectionId: otherCollectionId, name: "Law's consultation" },
  ];
  const locations = [
    { id: generateId({ model: "location" }), merchantId, name: "Thousand Sunny" },
    { id: generateId({ model: "location" }), merchantId, name: "Water 7" },
    { id: generateId({ model: "location" }), merchantId: otherMerchantId, name: "Polar Tang" },
  ];
  if (productType === "item") {
    await db.insert(tables.location).values(locations);
  }

  for (const product of products) {
    await db.insert(tables.product).values({
      ...product,
      slug: product.id.toLowerCase(),
      price: "25.00",
      unitCost: productType === "item" ? "10.00" : "0.00",
      type: productType,
      status: productType === "item" ? "draft" : "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const variantId = generateId({ model: "variant" });
    await db.insert(tables.variant).values({
      id: variantId,
      productId: product.id,
      merchantId: product.merchantId,
      name: product.name,
      price: "25.00",
      sku: productType === "item" ? product.id : null,
      barcode: productType === "item" ? variantId : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    if (productType === "item") {
      await db.insert(tables.inventoryLevel).values(
        locations
          .filter((location) => location.merchantId === product.merchantId)
          .map((location) => ({
            id: generateId({ model: "inventoryLevel" }),
            merchantId: product.merchantId,
            variantId,
            locationId: location.id,
            onHand: 0,
            lowStockThreshold: 2,
            optimalStockLevel: 10,
          })),
      );
    }
    await db.insert(tables.productImage).values({
      id: generateId({ model: "img" }),
      productId: product.id,
      merchantId: product.merchantId,
      source: "remote",
      remoteUrl: "https://strawhatpirates.example.com/clinic.webp",
      status: "available",
      activatedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  const service = UpdateProductService.create({
    db,
    collectionFinder: new CollectionFinder(),
    productFinder: new ProductFinder(),
    logger: pino({ enabled: false }),
    user: {
      id: "luffy",
      employeeId: "chopper",
      email: "chopper@strawhatpirates.example.com",
      accountType: "owner",
      merchantId,
    },
  });
  return {
    db,
    service,
    merchantId,
    productId,
    neighborProductId,
    otherProductId,
    replacementCollectionId,
    otherCollectionId,
  };
}

describe("UpdateProductService services", () => {
  it("saves supplied fields, synchronizes the variant, and archives the replaced image without changing other products", async () => {
    const { db, service, productId, replacementCollectionId } = await setup();
    const before = await readState(db);

    const result = await service.execute([
      productId,
      {
        name: "Chopper's checkup",
        price: "35.50",
        collectionId: replacementCollectionId,
        imageUrl: "https://strawhatpirates.example.com/checkup.webp",
        sku: "CHOPPER-01",
        barcode: "20001",
        unitCost: "20.00",
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({
      id: productId,
      name: "Chopper's checkup",
      price: "35.50",
      unitCost: "0.00",
      collection: { id: replacementCollectionId },
      imageUrl: "https://strawhatpirates.example.com/checkup.webp",
      variants: [{ name: "Chopper's checkup", price: "35.50", sku: null, barcode: null }],
    });
    const after = await readState(db);
    const original = before.products.find((product) => product.id === productId)!;
    expect(after.products.find((product) => product.id === productId)).toEqual({
      ...original,
      name: "Chopper's checkup",
      price: "35.50",
      collectionId: replacementCollectionId,
      updatedAt: expect.any(Date),
    });
    const variant = before.variants.find((variant) => variant.productId === productId)!;
    expect(after.variants.find((record) => record.id === variant.id)).toEqual({
      ...variant,
      name: "Chopper's checkup",
      price: "35.50",
      updatedAt: expect.any(Date),
    });
    const previousImage = before.images.find((image) => image.productId === productId)!;
    expect(after.images.find((image) => image.id === previousImage.id)).toEqual({
      ...previousImage,
      archivedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(after.images.filter((image) => image.productId === productId && image.archivedAt === null)).toEqual([
      expect.objectContaining({
        source: "remote",
        remoteUrl: "https://strawhatpirates.example.com/checkup.webp",
        status: "available",
        activatedAt: expect.any(Date),
      }),
    ]);
    expect(after.products.filter((product) => product.id !== productId)).toEqual(
      before.products.filter((product) => product.id !== productId),
    );
    expect(after.variants.filter((variant) => variant.productId !== productId)).toEqual(
      before.variants.filter((variant) => variant.productId !== productId),
    );
    expect(after.images.filter((image) => image.productId !== productId)).toEqual(
      before.images.filter((image) => image.productId !== productId),
    );
    expect(await db.select().from(tables.inventoryLevel)).toEqual([]);
  });

  it.each([{ name: "Chopper's checkup" }, { price: "35.50" }])(
    "preserves omitted fields when applying %j",
    async (request) => {
      const { db, service, productId, merchantId } = await setup();
      const before = await readState(db);
      const original = await new ProductFinder().find(db, { merchantId, id: productId });

      const result = await service.execute([productId, request]);

      expect(result.success).toBe(true);
      expect(result.value).toMatchObject({
        ...original,
        ...request,
        updatedAt: expect.any(Date),
        variants: [{ ...original!.variants[0], ...request, updatedAt: expect.any(Date) }],
      });
      const after = await readState(db);
      expect(after.products).toEqual(
        before.products.map((product) =>
          product.id === productId ? { ...product, ...request, updatedAt: expect.any(Date) } : product,
        ),
      );
      expect(after.variants).toEqual(
        before.variants.map((variant) =>
          variant.productId === productId ? { ...variant, ...request, updatedAt: expect.any(Date) } : variant,
        ),
      );
      expect(after.images).toEqual(before.images);
    },
  );

  it("clears the collection and image without changing variants or resurrecting older images", async () => {
    const { db, service, productId, merchantId } = await setup();
    await db.insert(tables.productImage).values({
      id: generateId({ model: "img" }),
      merchantId,
      productId,
      source: "remote",
      remoteUrl: "https://strawhatpirates.example.com/old-clinic.webp",
      status: "available",
      activatedAt: new Date("2025-01-01T00:00:00Z"),
    });
    const before = await readState(db);

    const result = await service.execute([productId, { collectionId: null, imageUrl: null }]);

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({ collection: null, imageUrl: null });
    const after = await readState(db);
    expect(after.products).toEqual(
      before.products.map((product) =>
        product.id === productId ? { ...product, collectionId: null, updatedAt: expect.any(Date) } : product,
      ),
    );
    expect(after.variants).toEqual(before.variants);
    expect(after.images).toEqual(
      before.images.map((image) =>
        image.productId === productId ? { ...image, archivedAt: expect.any(Date), updatedAt: expect.any(Date) } : image,
      ),
    );
  });

  it("persists a null collection when it is the only supplied service field", async () => {
    const { db, service, productId } = await setup();
    const before = await readState(db);

    const result = await service.execute([productId, { collectionId: null }]);

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({
      id: productId,
      collection: null,
      imageUrl: "https://strawhatpirates.example.com/clinic.webp",
      updatedAt: expect.any(Date),
    });
    const after = await readState(db);
    expect(after.products).toEqual(
      before.products.map((product) =>
        product.id === productId ? { ...product, collectionId: null, updatedAt: expect.any(Date) } : product,
      ),
    );
    expect(after.variants).toEqual(before.variants);
    expect(after.images).toEqual(before.images);
  });

  it("clears the image when it is the only supplied service field", async () => {
    const { db, service, productId } = await setup();
    const before = await readState(db);

    const result = await service.execute([productId, { imageUrl: null }]);

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({
      id: productId,
      collection: { name: "Chopper's clinic" },
      imageUrl: null,
      updatedAt: expect.any(Date),
    });
    const after = await readState(db);
    expect(after.products).toEqual(
      before.products.map((product) =>
        product.id === productId ? { ...product, updatedAt: expect.any(Date) } : product,
      ),
    );
    expect(after.variants).toEqual(before.variants);
    expect(after.images).toEqual(
      before.images.map((image) =>
        image.productId === productId ? { ...image, archivedAt: expect.any(Date), updatedAt: expect.any(Date) } : image,
      ),
    );
  });

  it.each([{}, { sku: "CHOPPER-01", barcode: "20001", unitCost: "20.00" }])(
    "leaves persisted data unchanged for a request with no service fields: %j",
    async (request) => {
      const { db, service, productId, merchantId } = await setup();
      const before = await readState(db);
      const original = await new ProductFinder().find(db, { merchantId, id: productId });

      const result = await service.execute([productId, request]);

      expect(result).toEqual({ success: true, value: original });
      expect(await readState(db)).toEqual(before);
    },
  );

  it.each(["missing", "other merchant"])("rejects a %s collection without saving any changes", async (scenario) => {
    const { db, service, productId, otherCollectionId } = await setup();
    const before = await readState(db);
    const collectionId = scenario === "missing" ? generateId({ model: "collection" }) : otherCollectionId;

    const result = await service.execute([productId, { name: "Chopper's checkup", collectionId, imageUrl: null }]);

    expect(result).toEqual({
      success: false,
      error: { code: codes.resourceNotFound, message: `Collection ${collectionId} has not been found.`, details: [] },
    });
    expect(await readState(db)).toEqual(before);
  });

  it.each(["missing", "other merchant"])("rejects a %s product without saving any changes", async (scenario) => {
    const { db, service, otherProductId } = await setup();
    const before = await readState(db);
    const productId = scenario === "missing" ? generateId({ model: "product" }) : otherProductId;

    const result = await service.execute([productId, { name: "Chopper's checkup", imageUrl: null }]);

    expect(result).toEqual({
      success: false,
      error: { code: codes.resourceNotFound, message: `Product ${productId} has not been found.`, details: [] },
    });
    expect(await readState(db)).toEqual(before);
  });

  it("rolls back product, variant, and image changes when inserting the replacement image fails", async () => {
    const { db, service, productId, replacementCollectionId } = await setup();
    const before = await readState(db);
    await db.execute(sql`CREATE TRIGGER reject_clinic_image BEFORE INSERT ON product_images
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Image storage unavailable'`);

    try {
      await expect(
        service.execute([
          productId,
          {
            name: "Chopper's checkup",
            price: "35.50",
            collectionId: replacementCollectionId,
            imageUrl: "https://strawhatpirates.example.com/checkup.webp",
          },
        ]),
      ).rejects.toMatchObject({ cause: { sqlMessage: "Image storage unavailable" } });

      expect(await readState(db)).toEqual(before);
    } finally {
      await db.execute(sql`DROP TRIGGER reject_clinic_image`);
    }
  });
});

describe("UpdateProductService items", () => {
  it("updates a draft item and its variant while preserving inventory, status, slug, and unrelated records", async () => {
    const { db, service, productId, replacementCollectionId } = await setup("item");
    const before = await readState(db);

    const result = await service.execute([
      productId,
      {
        name: "Chopper's medicine",
        price: "35.50",
        unitCost: "35.50",
        sku: "CHOPPER-01",
        barcode: "20001",
        collectionId: replacementCollectionId,
        imageUrl: "https://strawhatpirates.example.com/medicine.webp",
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({
      id: productId,
      name: "Chopper's medicine",
      price: "35.50",
      unitCost: "35.50",
      status: "draft",
      collection: { id: replacementCollectionId },
      imageUrl: "https://strawhatpirates.example.com/medicine.webp",
      variants: [{ name: "Chopper's medicine", price: "35.50", sku: "CHOPPER-01", barcode: "20001" }],
    });
    const after = await readState(db);
    expect(after.products).toEqual(
      before.products.map((product) =>
        product.id === productId
          ? {
              ...product,
              name: "Chopper's medicine",
              price: "35.50",
              unitCost: "35.50",
              inventoryVersion: product.inventoryVersion + 1,
              collectionId: replacementCollectionId,
              updatedAt: expect.any(Date),
            }
          : product,
      ),
    );
    expect(after.variants).toEqual(
      before.variants.map((variant) =>
        variant.productId === productId
          ? {
              ...variant,
              name: "Chopper's medicine",
              price: "35.50",
              sku: "CHOPPER-01",
              barcode: "20001",
              updatedAt: expect.any(Date),
            }
          : variant,
      ),
    );
    const oldImage = before.images.find((image) => image.productId === productId)!;
    expect(after.images.find((image) => image.id === oldImage.id)).toEqual({
      ...oldImage,
      archivedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(after.images.filter((image) => image.productId === productId && image.archivedAt === null)).toEqual([
      expect.objectContaining({
        source: "remote",
        status: "available",
        remoteUrl: "https://strawhatpirates.example.com/medicine.webp",
        activatedAt: expect.any(Date),
      }),
    ]);
    expect(after.images.filter((image) => image.productId !== productId)).toEqual(
      before.images.filter((image) => image.productId !== productId),
    );
    expect(after.inventory).toEqual(before.inventory);
  });

  it.each([
    { name: "Chopper's medicine" },
    { price: "20.00" },
    { unitCost: "20.00" },
    { sku: null },
    { barcode: null },
  ])("patches only supplied item fields for %j", async (request) => {
    const { db, service, productId } = await setup("item");
    const before = await readState(db);
    const { name, price, unitCost, sku, barcode } = request;
    const productChanges = {
      ...(name !== undefined ? { name } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(unitCost !== undefined ? { unitCost } : {}),
    };
    const variantChanges = {
      ...(name !== undefined ? { name } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(sku !== undefined ? { sku } : {}),
      ...(barcode !== undefined ? { barcode } : {}),
    };

    const result = await service.execute([productId, request]);

    expect(result.success).toBe(true);
    const after = await readState(db);
    expect(after.products).toEqual(
      before.products.map((product) =>
        product.id === productId
          ? {
              ...product,
              ...productChanges,
              ...(unitCost !== undefined && unitCost !== product.unitCost
                ? { inventoryVersion: product.inventoryVersion + 1 }
                : {}),
              updatedAt: expect.any(Date),
            }
          : product,
      ),
    );
    expect(after.variants).toEqual(
      before.variants.map((variant) =>
        variant.productId === productId && unitCost === undefined
          ? { ...variant, ...variantChanges, updatedAt: expect.any(Date) }
          : variant,
      ),
    );
    expect(after.images).toEqual(before.images);
    expect(after.inventory).toEqual(before.inventory);
  });

  it.each([
    { scenario: "zero cost", request: { unitCost: "0.00" }, code: codes.validationError },
    { scenario: "price below stored cost", request: { price: "9.99" }, code: codes.priceBelowUnitCost },
    { scenario: "cost above stored price", request: { unitCost: "25.01" }, code: codes.priceBelowUnitCost },
    {
      scenario: "price below new cost",
      request: { price: "30.00", unitCost: "30.01" },
      code: codes.priceBelowUnitCost,
    },
  ])("rejects $scenario without changing any records", async ({ request, code }) => {
    const { db, service, productId } = await setup("item");
    const before = await readState(db);

    const result = await service.execute([productId, { ...request, name: "Chopper's medicine", imageUrl: null }]);

    expect(result).toMatchObject({ success: false, error: { code } });
    expect(await readState(db)).toEqual(before);
  });

  it.each(["active", "archived"] as const)(
    "rejects a cost change on an %s item even when stock is zero",
    async (status) => {
      const { db, service, productId } = await setup("item");
      await db.update(tables.product).set({ status }).where(eq(tables.product.id, productId));
      const before = await readState(db);

      const result = await service.execute([productId, { unitCost: "12.00", name: "Chopper's medicine" }]);

      expect(result).toEqual({
        success: false,
        error: {
          code: codes.validationError,
          message: "The unit cost cannot be changed after an inventory movement.",
          details: [],
        },
      });
      expect(await readState(db)).toEqual(before);
    },
  );

  it.each([
    { status: "active", unitCost: "10" },
    { status: "archived", unitCost: "10.0" },
    { status: "active", unitCost: undefined },
  ] as const)("allows other edits on a $status item with unit cost $unitCost", async ({ status, unitCost }) => {
    const { db, service, productId } = await setup("item");
    await db.update(tables.product).set({ status }).where(eq(tables.product.id, productId));
    const before = await readState(db);

    const result = await service.execute([productId, { name: "Chopper's medicine", unitCost }]);

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({ name: "Chopper's medicine", unitCost: "10.00", status });
    const after = await readState(db);
    expect(after.products).toEqual(
      before.products.map((product) =>
        product.id === productId ? { ...product, name: "Chopper's medicine", updatedAt: expect.any(Date) } : product,
      ),
    );
    expect(after.variants).toEqual(
      before.variants.map((variant) =>
        variant.productId === productId
          ? { ...variant, name: "Chopper's medicine", updatedAt: expect.any(Date) }
          : variant,
      ),
    );
    expect(after.images).toEqual(before.images);
    expect(after.inventory).toEqual(before.inventory);
  });

  it.each(["sku", "barcode"] as const)("rejects another item's %s and rolls back earlier writes", async (field) => {
    const { db, service, productId, neighborProductId } = await setup("item");
    await db.update(tables.product).set({ status: "archived" }).where(eq(tables.product.id, neighborProductId));
    const before = await readState(db);
    const neighbor = before.variants.find((variant) => variant.productId === neighborProductId)!;

    const result = await service.execute([
      productId,
      { [field]: neighbor[field], name: "Chopper's medicine", unitCost: "20.00", imageUrl: null },
    ]);

    expect(result).toMatchObject({
      success: false,
      error: { code: field === "sku" ? codes.skuAlreadyExists : codes.barcodeAlreadyExists },
    });
    expect(await readState(db)).toEqual(before);
  });

  it.each(["current item", "other merchant"])("accepts identifiers already used by the %s", async (scenario) => {
    const { db, service, productId, otherProductId } = await setup("item");
    const before = await readState(db);
    const source = before.variants.find(
      (variant) => variant.productId === (scenario === "current item" ? productId : otherProductId),
    )!;

    const result = await service.execute([productId, { sku: source.sku, barcode: source.barcode }]);

    expect(result.success).toBe(true);
    expect(result.value?.variants).toMatchObject([{ sku: source.sku, barcode: source.barcode }]);
    const after = await readState(db);
    expect(after.products).toEqual(
      before.products.map((product) =>
        product.id === productId ? { ...product, updatedAt: expect.any(Date) } : product,
      ),
    );
    expect(after.variants).toEqual(
      before.variants.map((variant) =>
        variant.productId === productId
          ? { ...variant, sku: source.sku, barcode: source.barcode, updatedAt: expect.any(Date) }
          : variant,
      ),
    );
    expect(after.images).toEqual(before.images);
    expect(after.inventory).toEqual(before.inventory);
  });

  it("clears an item's collection and image while preserving its variant and inventory", async () => {
    const { db, service, productId } = await setup("item");
    const before = await readState(db);

    const result = await service.execute([productId, { collectionId: null, imageUrl: null }]);

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({ collection: null, imageUrl: null });
    const after = await readState(db);
    expect(after.products).toEqual(
      before.products.map((product) =>
        product.id === productId ? { ...product, collectionId: null, updatedAt: expect.any(Date) } : product,
      ),
    );
    expect(after.images).toEqual(
      before.images.map((image) =>
        image.productId === productId ? { ...image, archivedAt: expect.any(Date), updatedAt: expect.any(Date) } : image,
      ),
    );
    expect(after.variants).toEqual(before.variants);
    expect(after.inventory).toEqual(before.inventory);
  });

  it.each(["missing", "other merchant"])(
    "rejects a %s collection for an item without saving changes",
    async (scenario) => {
      const { db, service, productId, otherCollectionId } = await setup("item");
      const before = await readState(db);
      const collectionId = scenario === "missing" ? generateId({ model: "collection" }) : otherCollectionId;

      const result = await service.execute([productId, { name: "Chopper's medicine", collectionId }]);

      expect(result).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
      expect(await readState(db)).toEqual(before);
    },
  );

  it("returns an item unchanged for an empty request", async () => {
    const { db, service, productId, merchantId } = await setup("item");
    const before = await readState(db);
    const product = await new ProductFinder().find(db, { merchantId, id: productId });

    const result = await service.execute([productId, {}]);

    expect(result).toEqual({ success: true, value: product });
    expect(await readState(db)).toEqual(before);
  });

  it("rolls back item and variant changes when the replacement image cannot be inserted", async () => {
    const { db, service, productId } = await setup("item");
    const before = await readState(db);
    await db.execute(sql`CREATE TRIGGER reject_medicine_image BEFORE INSERT ON product_images
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Image storage unavailable'`);

    try {
      await expect(
        service.execute([
          productId,
          {
            name: "Chopper's medicine",
            price: "35.50",
            unitCost: "20.00",
            sku: "CHOPPER-01",
            imageUrl: "https://strawhatpirates.example.com/medicine.webp",
          },
        ]),
      ).rejects.toMatchObject({ cause: { sqlMessage: "Image storage unavailable" } });

      expect(await readState(db)).toEqual(before);
    } finally {
      await db.execute(sql`DROP TRIGGER reject_medicine_image`);
    }
  });

  it("keeps price at least cost when separate price and cost edits run concurrently", async () => {
    const { db, service, productId } = await setup("item");
    const lockName = `update_product_${generateId({ length: 18 })}`;

    const results = await waitForBlockedUpdate(db, "products", lockName, () =>
      Promise.all([
        service.execute([productId, { price: "15.00" }]),
        service.execute([productId, { unitCost: "20.00" }]),
      ]),
    );

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.find((result) => !result.success)).toMatchObject({ error: { code: codes.priceBelowUnitCost } });
    const [product] = await db.select().from(tables.product).where(eq(tables.product.id, productId));
    expect([
      { price: "15.00", unitCost: "10.00" },
      { price: "25.00", unitCost: "20.00" },
    ]).toContainEqual({ price: product.price, unitCost: product.unitCost });
    const [variant] = await db.select().from(tables.variant).where(eq(tables.variant.productId, productId));
    expect(variant.price).toBe(product.price);
  });
});
