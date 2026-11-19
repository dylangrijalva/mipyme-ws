import { and, eq, inArray, sql } from "drizzle-orm";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import type { Database } from "../../../src/db/index.ts";
import { tables } from "../../../src/db/schema.ts";
import { CollectionFinder } from "../../../src/finders/collection-finder.ts";
import { ProductFinder } from "../../../src/finders/product-finder.ts";
import { noopLogger } from "../../../src/infra/config.logger.ts";
import { ProductImageStore } from "../../../src/integrations/product-image-store.ts";
import { UpdateProductService } from "../../../src/services/catalog/products/update-product-service.ts";
import { EmployeeManagement } from "../../../src/services/employee-management.ts";
import { InventoryManagement } from "../../../src/services/inventory-management.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import {
  createRealtimeEventPublisherMock,
  trackCommittedBroadcasts,
} from "../../test-utils/realtime-publisher-mock.ts";
import { createRealtimeEnv } from "../../test-utils/realtime-env.ts";
import { waitForBlockedUpdate } from "../../test-utils/wait-for-blocked-update.ts";
import { EmployeeAuthorizationService } from "../../../src/services/employee-authorization-service.ts";

async function readState(db: Database) {
  return {
    products: await db.select().from(tables.product).orderBy(tables.product.id),
    variants: await db.select().from(tables.variant).orderBy(tables.variant.id),
    images: await db.select().from(tables.productImage).orderBy(tables.productImage.id),
    inventory: await db.select().from(tables.inventoryLevel).orderBy(tables.inventoryLevel.id),
    movements: await db.select().from(tables.inventoryMovement).orderBy(tables.inventoryMovement.id),
  };
}

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
  const chopperId = generateId({ model: "employee" });
  const namiId = generateId({ model: "employee" });
  const robinId = generateId({ model: "employee" });
  const timestamp = new Date("2026-01-01T00:00:00Z");

  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  await db.insert(tables.employee).values([
    { id: chopperId, merchantId, name: "Tony Tony Chopper", isOwner: true, status: "enabled", pin: "3333" },
    { id: namiId, merchantId, name: "Nami", status: "enabled", pin: "4821" },
    { id: robinId, merchantId, name: "Nico Robin", status: "disabled", pin: "1999" },
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
  const { broadcast, publisher } = createRealtimeEventPublisherMock();
  const service = UpdateProductService.create({
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
      employeeId: chopperId,
      email: "chopper@strawhatpirates.example.com",
      accountType: "owner",
      merchantId,
    },
  });
  return {
    broadcast,
    db,
    service,
    merchantId,
    productId,
    neighborProductId,
    otherProductId,
    replacementCollectionId,
    otherCollectionId,
    thousandSunnyId: locations[0].id,
    waterSevenId: locations[1].id,
    polarTangId: locations[2].id,
    chopperId,
    namiId,
    robinId,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("UpdateProductService services", () => {
  it("rejects an image from managed storage without changing products or broadcasting", async () => {
    const { broadcast, db, service, productId } = await setup();
    const before = await readState(db);

    const result = await service.execute([
      productId,
      { name: "Chopper's checkup", imageUrl: `${MANAGED_STORAGE_URL}uploads/checkup.webp` },
    ]);

    expect(result).toEqual({
      success: false,
      error: {
        code: codes.validationError,
        message: "Verify a product image upload before using an image from managed storage.",
        details: [],
      },
    });
    expect(await readState(db)).toEqual(before);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("saves supplied fields, synchronizes the variant, and archives the replaced image without changing other products", async () => {
    const { broadcast, merchantId, db, service, productId, replacementCollectionId } = await setup();
    const before = await readState(db);

    const committedAtPublish = trackCommittedBroadcasts(db, broadcast);

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

    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "product", snapshot: result.value },
    });
    expect(committedAtPublish).toEqual([true]);

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
      const original = await new ProductFinder(new CollectionFinder()).find(db, { merchantId, id: productId });

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
      const original = await new ProductFinder(new CollectionFinder()).find(db, { merchantId, id: productId });

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
    const { broadcast, merchantId, db, service, productId, replacementCollectionId } = await setup("item");
    const before = await readState(db);

    const committedAtPublish = trackCommittedBroadcasts(db, broadcast);

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

    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "product", snapshot: result.value },
    });
    expect(committedAtPublish).toEqual([true]);

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
    const previousUpdatedAt = before.products.find((product) => product.id === productId)!.updatedAt;
    vi.spyOn(Date, "now").mockReturnValue(previousUpdatedAt.getTime());
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
    expect(after.products.find((product) => product.id === productId)!.updatedAt.getTime()).toBeGreaterThan(
      previousUpdatedAt.getTime(),
    );
    expect(after.products).toEqual(
      before.products.map((product) =>
        product.id === productId
          ? {
              ...product,
              ...productChanges,
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

  it.each(["draft", "active", "archived"] as const)(
    "rejects a cost change on a %s item after an inventory movement even when stock is zero",
    async (status) => {
      const { db, service, productId } = await setup("item");
      const [variant] = await db.select().from(tables.variant).where(eq(tables.variant.productId, productId));
      const [level] = await db
        .select()
        .from(tables.inventoryLevel)
        .where(eq(tables.inventoryLevel.variantId, variant.id));
      await db.update(tables.product).set({ status }).where(eq(tables.product.id, productId));
      await db
        .update(tables.inventoryLevel)
        .set({ lastInventoryAdjustmentAt: new Date("2026-10-15T18:00:00.000Z") })
        .where(eq(tables.inventoryLevel.id, level.id));
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

  it.each(["active", "archived"] as const)(
    "changes the cost of a %s item that has no inventory movements",
    async (status) => {
      const { db, service, productId } = await setup("item");
      await db.update(tables.product).set({ status }).where(eq(tables.product.id, productId));

      const result = await service.execute([productId, { unitCost: "12.00" }]);

      expect(result).toMatchObject({ success: true, value: { unitCost: "12.00", status } });
      const [product] = await db.select().from(tables.product).where(eq(tables.product.id, productId));
      expect(product.unitCost).toBe("12.00");
    },
  );

  it("changes the cost of an item when only other products have inventory movements", async () => {
    const { db, service, productId, neighborProductId, otherProductId } = await setup("item");
    const otherVariants = await db
      .select({ id: tables.variant.id })
      .from(tables.variant)
      .where(inArray(tables.variant.productId, [neighborProductId, otherProductId]));
    const [movedLevels] = await db
      .update(tables.inventoryLevel)
      .set({ lastInventoryAdjustmentAt: new Date("2026-10-15T18:00:00.000Z") })
      .where(
        inArray(
          tables.inventoryLevel.variantId,
          otherVariants.map((variant) => variant.id),
        ),
      );
    expect(movedLevels.affectedRows).toBeGreaterThanOrEqual(2);

    const result = await service.execute([productId, { unitCost: "12.00" }]);

    expect(result).toMatchObject({ success: true, value: { unitCost: "12.00" } });
  });

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
    const { broadcast, db, service, productId, merchantId } = await setup("item");
    const before = await readState(db);
    const product = await new ProductFinder(new CollectionFinder()).find(db, { merchantId, id: productId });

    const result = await service.execute([productId, {}]);

    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "product", snapshot: result.value },
    });

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

const NOW = new Date("2026-11-19T15:00:00.000Z");
const EARLIER = new Date("2026-10-15T18:00:00.000Z");

async function readVariantId(db: Database, productId: string): Promise<string> {
  const [variant] = await db.select().from(tables.variant).where(eq(tables.variant.productId, productId));
  return variant.id;
}

async function readLevelsByLocation(db: Database, variantId: string) {
  const levels = await db.select().from(tables.inventoryLevel).where(eq(tables.inventoryLevel.variantId, variantId));
  return new Map(levels.map((level) => [level.locationId, level]));
}

async function markInventoryMovement(db: Database, variantId: string, locationId: string, onHand: number) {
  await db
    .update(tables.inventoryLevel)
    .set({ onHand, lastRestockAt: EARLIER, lastInventoryAdjustmentAt: EARLIER })
    .where(and(eq(tables.inventoryLevel.variantId, variantId), eq(tables.inventoryLevel.locationId, locationId)));
}

describe("UpdateProductService item inventory levels", () => {
  it("records initial stock on an uninitialized item, keeps omitted thresholds, and adds a level for a newer location", async () => {
    const { broadcast, db, service, merchantId, productId, thousandSunnyId, waterSevenId, chopperId } =
      await setup("item");
    const dressrosaId = generateId({ model: "location" });
    await db.insert(tables.location).values({ id: dressrosaId, merchantId, name: "Dressrosa" });
    const variantId = await readVariantId(db, productId);
    const before = await readState(db);
    vi.spyOn(Date, "now").mockReturnValue(NOW.getTime());

    const result = await service.execute([
      productId,
      {
        inventoryLevels: [
          { locationId: thousandSunnyId, onHand: 7 },
          { locationId: dressrosaId, onHand: 3, lowStockThreshold: 1 },
        ],
      },
    ]);

    expect(result.success).toBe(true);
    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "product", snapshot: result.value },
    });
    const levels = await readLevelsByLocation(db, variantId);
    expect(levels.get(thousandSunnyId)).toMatchObject({
      onHand: 7,
      lowStockThreshold: 2,
      optimalStockLevel: 10,
      lastRestockAt: NOW,
      lastInventoryAdjustmentAt: NOW,
    });
    expect(levels.get(dressrosaId)).toMatchObject({
      merchantId,
      onHand: 3,
      lowStockThreshold: 1,
      optimalStockLevel: 0,
      lastRestockAt: NOW,
      lastInventoryAdjustmentAt: NOW,
    });
    const waterSevenBefore = before.inventory.find(
      (level) => level.variantId === variantId && level.locationId === waterSevenId,
    );
    expect(waterSevenBefore).toBeDefined();
    expect(levels.size).toBe(3);
    expect(levels.get(waterSevenId)).toEqual(waterSevenBefore);
    const after = await readState(db);
    expect(after.inventory.filter((level) => level.variantId !== variantId)).toEqual(
      before.inventory.filter((level) => level.variantId !== variantId),
    );
    expect(after.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventoryLevelId: levels.get(thousandSunnyId)?.id,
          reason: "initial_stock",
          fromState: "none",
          toState: "in_stock",
          quantityDelta: 7,
          unitCost: "10.00",
          referenceId: null,
          createdById: chopperId,
          occurredAt: NOW,
        }),
        expect.objectContaining({
          inventoryLevelId: levels.get(dressrosaId)?.id,
          reason: "initial_stock",
          quantityDelta: 3,
          unitCost: "10.00",
          createdById: chopperId,
        }),
      ]),
    );
    expect(after.movements).toHaveLength(2);
    const [product] = after.products.filter((storedProduct) => storedProduct.id === productId);
    expect(product.lastRestockAt).toEqual(NOW);
    expect(product.status).toBe("active");
    expect(result.value?.status).toBe("active");
  });

  it.each([
    { scenario: "only its thresholds change", level: { lowStockThreshold: 1 } },
    { scenario: "its opening stock is explicitly zero", level: { onHand: 0 } },
  ])("keeps a draft item in draft when $scenario", async ({ level }) => {
    const { db, service, productId, thousandSunnyId } = await setup("item");

    const result = await service.execute([productId, { inventoryLevels: [{ locationId: thousandSunnyId, ...level }] }]);

    expect(result.value?.status).toBe("draft");
    const [product] = await db.select().from(tables.product).where(eq(tables.product.id, productId));
    expect(product).toMatchObject({ status: "draft", lastRestockAt: null });
  });

  it.each(["active", "archived"] as const)(
    "keeps the status of an %s item when its opening stock is set",
    async (status) => {
      const { db, service, productId, thousandSunnyId } = await setup("item");
      await db.update(tables.product).set({ status }).where(eq(tables.product.id, productId));

      const result = await service.execute([
        productId,
        { inventoryLevels: [{ locationId: thousandSunnyId, onHand: 4 }] },
      ]);

      expect(result.value?.status).toBe(status);
      const [product] = await db.select().from(tables.product).where(eq(tables.product.id, productId));
      expect(product).toMatchObject({ status, lastRestockAt: expect.any(Date) });
    },
  );

  it("records initial stock at a new unit cost, credits the requested employee, and then locks the cost", async () => {
    const { db, service, productId, waterSevenId, namiId } = await setup("item");

    const result = await service.execute([
      productId,
      { unitCost: "12.00", createdById: namiId, inventoryLevels: [{ locationId: waterSevenId, onHand: 4 }] },
    ]);
    const costChange = await service.execute([productId, { unitCost: "13.00" }]);

    expect(result).toMatchObject({ success: true, value: { unitCost: "12.00" } });
    expect(await db.select().from(tables.inventoryMovement)).toEqual([
      expect.objectContaining({ unitCost: "12.00", createdById: namiId, quantityDelta: 4 }),
    ]);
    expect(costChange).toMatchObject({ success: false, error: { code: codes.validationError } });
    const [product] = await db.select().from(tables.product).where(eq(tables.product.id, productId));
    expect(product.unitCost).toBe("12.00");
  });

  it.each([0, 5])(
    "rejects on hand %s once another location has an inventory movement without changing records",
    async (onHand) => {
      const { broadcast, db, service, productId, thousandSunnyId, waterSevenId } = await setup("item");
      await markInventoryMovement(db, await readVariantId(db, productId), waterSevenId, 6);
      const before = await readState(db);

      const result = await service.execute([
        productId,
        {
          name: "Chopper's medicine",
          inventoryLevels: [{ locationId: thousandSunnyId, onHand, lowStockThreshold: 3 }],
        },
      ]);

      expect(result).toEqual({
        success: false,
        error: {
          code: codes.validationError,
          message: "The on-hand quantity can only be set before the product's first inventory movement.",
          details: [],
        },
      });
      expect(await readState(db)).toEqual(before);
      expect(broadcast).not.toHaveBeenCalled();
    },
  );

  it("updates thresholds after initialization while keeping stock and stock timestamps", async () => {
    const { db, service, productId, thousandSunnyId } = await setup("item");
    const variantId = await readVariantId(db, productId);
    await markInventoryMovement(db, variantId, thousandSunnyId, 6);
    vi.spyOn(Date, "now").mockReturnValue(NOW.getTime());

    const result = await service.execute([
      productId,
      { inventoryLevels: [{ locationId: thousandSunnyId, lowStockThreshold: 9 }] },
    ]);

    expect(result.success).toBe(true);
    const levels = await readLevelsByLocation(db, variantId);
    expect(levels.get(thousandSunnyId)).toMatchObject({
      onHand: 6,
      lowStockThreshold: 9,
      optimalStockLevel: 10,
      lastRestockAt: EARLIER,
      lastInventoryAdjustmentAt: EARLIER,
      updatedAt: NOW,
    });
    expect(await db.select().from(tables.inventoryMovement)).toEqual([]);
    const [product] = await db.select().from(tables.product).where(eq(tables.product.id, productId));
    expect(product.lastRestockAt).toBeNull();
  });

  it.each([
    { scenario: "a low stock threshold equal to the stored optimal stock level", change: { lowStockThreshold: 10 } },
    { scenario: "an optimal stock level equal to the stored low stock threshold", change: { optimalStockLevel: 2 } },
  ])("rejects $scenario without changing records", async ({ change }) => {
    const { broadcast, db, service, productId, thousandSunnyId } = await setup("item");
    const before = await readState(db);

    const result = await service.execute([
      productId,
      { inventoryLevels: [{ locationId: thousandSunnyId, ...change }] },
    ]);

    expect(result).toEqual({
      success: false,
      error: {
        code: codes.validationError,
        message: "The low stock threshold must be lower than the optimal stock level.",
        details: [],
      },
    });
    expect(await readState(db)).toEqual(before);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it.each([
    {
      scenario: "a duplicate location",
      inventoryLevels: (ids: UpdateLocationIds) => [
        { locationId: ids.thousandSunnyId, onHand: 1 },
        { locationId: ids.thousandSunnyId, lowStockThreshold: 1 },
      ],
      code: codes.validationError,
    },
    {
      scenario: "a location of another merchant",
      inventoryLevels: (ids: UpdateLocationIds) => [{ locationId: ids.polarTangId, onHand: 1 }],
      code: codes.resourceNotFound,
    },
    {
      scenario: "a missing location",
      inventoryLevels: () => [{ locationId: generateId({ model: "location" }), lowStockThreshold: 1 }],
      code: codes.resourceNotFound,
    },
  ])("rejects $scenario without changing records", async ({ inventoryLevels, code }) => {
    const { broadcast, db, service, productId, thousandSunnyId, polarTangId } = await setup("item");
    const before = await readState(db);

    const result = await service.execute([
      productId,
      { name: "Chopper's medicine", inventoryLevels: inventoryLevels({ thousandSunnyId, polarTangId }) },
    ]);

    expect(result).toMatchObject({ success: false, error: { code } });
    expect(await readState(db)).toEqual(before);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("rejects an unknown credited employee without changing records", async () => {
    const { db, service, productId, thousandSunnyId } = await setup("item");
    const before = await readState(db);

    const result = await service.execute([
      productId,
      { createdById: generateId({ model: "employee" }), inventoryLevels: [{ locationId: thousandSunnyId, onHand: 2 }] },
    ]);

    expect(result).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    expect(await readState(db)).toEqual(before);
  });

  it.each([
    {
      scenario: "a service with inventory levels",
      productType: "service" as const,
      request: (ids: { robinId: string }) => ({
        createdById: ids.robinId,
        inventoryLevels: [{ locationId: generateId({ model: "location" }), onHand: 5 }],
      }),
    },
    {
      scenario: "an item when it is the only field sent",
      productType: "item" as const,
      request: (ids: { robinId: string }) => ({ createdById: ids.robinId }),
    },
  ])(
    "rejects a disabled credited employee for $scenario without changing records",
    async ({ productType, request }) => {
      const { broadcast, db, service, productId, robinId } = await setup(productType);
      const before = await readState(db);

      const result = await service.execute([productId, request({ robinId })]);

      expect(result).toMatchObject({ success: false, error: { code: codes.forbiddenError } });
      expect(await readState(db)).toEqual(before);
      expect(broadcast).not.toHaveBeenCalled();
    },
  );

  it("returns the item unchanged when only a credited employee is sent", async () => {
    const { db, service, productId, merchantId, namiId } = await setup("item");
    const before = await readState(db);
    const product = await new ProductFinder(new CollectionFinder()).find(db, { merchantId, id: productId });

    const result = await service.execute([productId, { createdById: namiId }]);

    expect(result).toEqual({ success: true, value: product });
    expect(await readState(db)).toEqual(before);
  });

  it("ignores inventory levels for a service", async () => {
    const { db, service, productId } = await setup();
    const before = await readState(db);

    const result = await service.execute([
      productId,
      { inventoryLevels: [{ locationId: generateId({ model: "location" }), onHand: 5, lowStockThreshold: 1 }] },
    ]);

    expect(result.success).toBe(true);
    expect(await readState(db)).toEqual(before);
  });

  it("records initial stock once when two requests initialize the same item concurrently", async () => {
    const { db, service, productId, thousandSunnyId, waterSevenId } = await setup("item");
    const lockName = `initial_stock_${generateId({ length: 18 })}`;

    const results = await waitForBlockedUpdate(db, "products", lockName, () =>
      Promise.all([
        service.execute([productId, { inventoryLevels: [{ locationId: thousandSunnyId, onHand: 5 }] }]),
        service.execute([productId, { inventoryLevels: [{ locationId: waterSevenId, onHand: 8 }] }]),
      ]),
    );

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.find((result) => !result.success)).toMatchObject({ error: { code: codes.validationError } });
    const movements = await db.select().from(tables.inventoryMovement);
    expect(movements).toHaveLength(1);
    const stockedLevels = await db
      .select()
      .from(tables.inventoryLevel)
      .where(eq(tables.inventoryLevel.variantId, await readVariantId(db, productId)));
    expect(stockedLevels.filter((level) => level.onHand > 0)).toEqual([
      expect.objectContaining({ id: movements[0].inventoryLevelId, onHand: movements[0].quantityDelta }),
    ]);
  });

  it("rolls back product and level changes when the initial stock movement cannot be stored", async () => {
    const { broadcast, db, service, productId, thousandSunnyId } = await setup("item");
    const before = await readState(db);
    await db.execute(sql`CREATE TRIGGER reject_update_initial_stock BEFORE INSERT ON inventory_movements
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Movement storage unavailable'`);

    try {
      await expect(
        service.execute([
          productId,
          { name: "Chopper's medicine", inventoryLevels: [{ locationId: thousandSunnyId, onHand: 5 }] },
        ]),
      ).rejects.toMatchObject({ cause: { sqlMessage: "Movement storage unavailable" } });

      expect(await readState(db)).toEqual(before);
      expect(broadcast).not.toHaveBeenCalled();
    } finally {
      await db.execute(sql`DROP TRIGGER reject_update_initial_stock`);
    }
  });
});

type UpdateLocationIds = { thousandSunnyId: string; polarTangId: string };
