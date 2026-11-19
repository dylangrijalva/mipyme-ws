import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import pino from "pino";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.ts";
import type { CurrentUser } from "../../src/contracts/current-user.ts";
import { tables } from "../../src/db/schema.ts";
import { ProductFinder } from "../../src/finders/product-finder.ts";
import { CollectionFinder } from "../../src/finders/collection-finder.ts";
import { CustomerFinder } from "../../src/finders/customer-finder.ts";
import { EmployeeFinder } from "../../src/finders/employee-finder.ts";
import { InvitationFinder } from "../../src/finders/invitation-finder.ts";
import { LocationFinder } from "../../src/finders/location-finder.ts";
import { MerchantFinder } from "../../src/finders/merchant-finder.ts";
import { PurchaseFinder } from "../../src/finders/purchase-finder.ts";
import { SaleFinder } from "../../src/finders/sale-finder.ts";
import { SupplierFinder } from "../../src/finders/supplier-finder.ts";
import { EmailSender } from "../../src/integrations/email-sender.ts";
import { IdentityProvider } from "../../src/integrations/identity-provider.ts";
import { ProductImageStore } from "../../src/integrations/product-image-store.ts";
import { RealtimeEventPublisher } from "../../src/integrations/realtime-event-publisher.ts";
import { EmployeeManagement } from "../../src/services/employee-management.ts";
import { InventoryManagement } from "../../src/services/inventory-management.ts";
import { IncrementalSyncService } from "../../src/services/sync/incremental-sync-service.ts";
import { generateId } from "../../src/utils/generate-id.ts";
import { ok } from "../../src/utils/result.ts";
import { prepareDatabase } from "../prepare-db.ts";
import { createRealtimeEnv } from "../test-utils/realtime-env.ts";

const infrastructure: { container?: StartedRedisContainer; cache?: Redis } = {};

beforeAll(async () => {
  infrastructure.container = await new RedisContainer("redis:8.2").start();
  infrastructure.cache = new Redis(infrastructure.container.getConnectionUrl(), {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
  });
  await infrastructure.cache.connect();
  await prepareDatabase();
}, 60_000);

beforeEach(async () => {
  await infrastructure.cache!.flushdb();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(async () => {
  await infrastructure.cache?.quit();
  await infrastructure.container?.stop();
});

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const foreignMerchantId = generateId({ model: "merchant" });
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: foreignMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  const seed = async (ownerId: string) => {
    const collectionId = generateId({ model: "collection" });
    const customerId = generateId({ model: "customer" });
    const supplierId = generateId({ model: "supplier" });
    const locationId = generateId({ model: "location" });
    const otherLocationId = generateId({ model: "location" });
    const productId = generateId({ model: "product" });
    const archivedProductId = generateId({ model: "product" });
    const variantId = generateId({ model: "variant" });
    const optionGroupId = generateId({ model: "optionGroup" });
    const optionId = generateId({ model: "option" });
    const inventoryLevelId = generateId({ model: "inventoryLevel" });
    await db
      .insert(tables.collection)
      .values({ id: collectionId, merchantId: ownerId, name: "East Blue provisions", slug: collectionId });
    await db.insert(tables.customer).values({ id: customerId, merchantId: ownerId, name: "Monkey D. Luffy" });
    await db.insert(tables.supplier).values({ id: supplierId, merchantId: ownerId, name: "Sanji" });
    await db.insert(tables.location).values([
      { id: locationId, merchantId: ownerId, name: "Water 7" },
      { id: otherLocationId, merchantId: ownerId, name: "Loguetown" },
    ]);
    const employeeId = generateId({ model: "employee" });
    await db
      .insert(tables.employee)
      .values({ id: employeeId, merchantId: ownerId, name: "Nami", status: "enabled", pin: "4821" });
    await db.insert(tables.locationAccess).values({
      id: generateId({ model: "locationAccess" }),
      merchantId: ownerId,
      employeeId,
      locationId,
    });
    await db.insert(tables.product).values([
      {
        id: productId,
        merchantId: ownerId,
        name: "Nami's mandarins",
        slug: productId,
        price: "20.00",
        unitCost: "10.00",
        collectionId,
        status: "active",
      },
      {
        id: archivedProductId,
        merchantId: ownerId,
        name: "Going Merry provisions",
        slug: archivedProductId,
        price: "10.00",
        unitCost: "5.00",
        status: "archived",
        archivedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    await db
      .insert(tables.variant)
      .values({ id: variantId, productId, merchantId: ownerId, name: "Mandarin crate", price: "20.00" });
    await db.insert(tables.optionGroup).values({ id: optionGroupId, merchantId: ownerId, name: "Crate size" });
    await db
      .insert(tables.option)
      .values({ id: optionId, merchantId: ownerId, optionGroupId, name: "Large", position: 1 });
    await db
      .insert(tables.productOptionGroup)
      .values({ id: generateId({ model: "productOptionGroup" }), merchantId: ownerId, productId, optionGroupId });
    await db
      .insert(tables.variantOption)
      .values({ id: generateId({ model: "productVariantOption" }), merchantId: ownerId, variantId, optionId });
    await db.insert(tables.productImage).values({
      id: generateId({ model: "img" }),
      merchantId: ownerId,
      productId,
      source: "remote",
      status: "available",
      remoteUrl: "https://strawhatpirates.example.com/old-mandarins.webp",
      activatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await db.insert(tables.inventoryLevel).values([
      { id: inventoryLevelId, merchantId: ownerId, variantId, locationId, onHand: 12 },
      {
        id: generateId({ model: "inventoryLevel" }),
        merchantId: ownerId,
        variantId,
        locationId: otherLocationId,
        onHand: 7,
      },
    ]);
    return {
      employeeId,
      collectionId,
      customerId,
      supplierId,
      locationId,
      otherLocationId,
      productId,
      archivedProductId,
      variantId,
      optionGroupId,
      optionId,
      inventoryLevelId,
    };
  };
  const records = await seed(merchantId);
  const foreign = await seed(foreignMerchantId);
  const baseline = new Date(Date.now() - 2 * 60 * 60 * 1000);
  for (const table of [
    tables.merchant,
    tables.collection,
    tables.customer,
    tables.supplier,
    tables.location,
    tables.employee,
    tables.product,
    tables.variant,
    tables.inventoryLevel,
    tables.option,
    tables.optionGroup,
    tables.productImage,
  ]) {
    await db.update(table).set({ createdAt: baseline, updatedAt: baseline });
  }
  const user: CurrentUser = {
    id: generateId({ model: "account" }),
    employeeId: generateId({ model: "employee" }),
    merchantId,
    email: "nami@strawhatpirates.example.com",
    accountType: "staff",
  };
  const dependencies = {
    db,
    cache: infrastructure.cache!,
    env: createRealtimeEnv(),
    logger: pino({ enabled: false }),
    user,
    merchantFinder: new MerchantFinder(),
    productFinder: new ProductFinder(),
    collectionFinder: new CollectionFinder(),
    customerFinder: new CustomerFinder(),
    supplierFinder: new SupplierFinder(),
    locationFinder: new LocationFinder(),
    employeeFinder: new EmployeeFinder(),
  };
  const service = IncrementalSyncService.create(dependencies);
  return { ...records, foreign, merchantId, foreignMerchantId, db, dependencies, service };
}

describe("IncrementalSyncService", () => {
  it("returns merchant updates without resending resources outside the overlap window", async () => {
    const fixture = await setup();
    const first = await fixture.service.execute({ syncToken: "*" });
    await fixture.db
      .update(tables.merchant)
      .set({ name: "Straw Hat Grand Fleet" })
      .where(eq(tables.merchant.id, fixture.merchantId));

    const result = await fixture.service.execute({ syncToken: first.value!.syncToken });

    expect(result.value).toMatchObject({
      fullSync: false,
      merchant: { id: fixture.merchantId, name: "Straw Hat Grand Fleet" },
      products: [],
      collections: [],
      customers: [],
      suppliers: [],
      locations: [],
      employees: [],
    });
    const [foreign] = await fixture.db
      .select()
      .from(tables.merchant)
      .where(eq(tables.merchant.id, fixture.foreignMerchantId));
    expect(foreign.name).toBe("Heart Pirates");
  });

  it("includes both timestamp boundaries and late rows inside the overlap while excluding older and future rows", async () => {
    const fixture = await setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    const initialTime = Date.now();
    vi.setSystemTime(initialTime);
    const first = await fixture.service.execute({ syncToken: "*" });
    const lowerBoundary = initialTime - 60 * 60 * 1000;
    const currentTime = initialTime + 2 * 60 * 60 * 1000;
    const lowerId = generateId({ model: "customer" });
    const overlapId = generateId({ model: "customer" });
    const upperId = generateId({ model: "customer" });
    await fixture.db.insert(tables.customer).values([
      {
        id: generateId({ model: "customer" }),
        merchantId: fixture.merchantId,
        name: "Usopp",
        createdAt: new Date(lowerBoundary - 1),
        updatedAt: new Date(lowerBoundary - 1),
      },
      {
        id: lowerId,
        merchantId: fixture.merchantId,
        name: "Nico Robin",
        createdAt: new Date(lowerBoundary),
        updatedAt: new Date(lowerBoundary),
      },
      {
        id: overlapId,
        merchantId: fixture.merchantId,
        name: "Roronoa Zoro",
        createdAt: new Date(initialTime - 30 * 60 * 1000),
        updatedAt: new Date(initialTime - 30 * 60 * 1000),
      },
      {
        id: upperId,
        merchantId: fixture.merchantId,
        name: "Sanji",
        createdAt: new Date(currentTime),
        updatedAt: new Date(currentTime),
      },
      {
        id: generateId({ model: "customer" }),
        merchantId: fixture.merchantId,
        name: "Franky",
        createdAt: new Date(currentTime + 1),
        updatedAt: new Date(currentTime + 1),
      },
    ]);
    vi.setSystemTime(currentTime);

    const result = await fixture.service.execute({ syncToken: first.value!.syncToken });
    const repeated = await fixture.service.execute({ syncToken: first.value!.syncToken });

    expect(result.value!.customers.map((customer) => customer.id).sort()).toEqual([lowerId, overlapId, upperId].sort());
    expect(repeated.value!.customers).toEqual(result.value!.customers);
    expect(result.value).toMatchObject({
      fullSync: false,
      merchant: null,
      products: [],
      collections: [],
      suppliers: [],
      locations: [],
      employees: [],
    });
  });

  it("returns complete merchant resources, archived products, and inventory at every location for staff", async () => {
    const fixture = await setup();

    const result = await fixture.service.execute({ syncToken: "*" });

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({
      fullSync: true,
      merchant: { id: fixture.merchantId, name: "Straw Hat Pirates" },
      syncToken: expect.any(String),
      collections: [{ id: fixture.collectionId }],
      customers: [{ id: fixture.customerId }],
      suppliers: [{ id: fixture.supplierId }],
    });
    expect(result.value!.locations.map((location) => location.id).sort()).toEqual(
      [fixture.locationId, fixture.otherLocationId].sort(),
    );
    expect(result.value!.employees).toMatchObject([
      { id: fixture.employeeId, name: "Nami", locationIds: [fixture.locationId] },
    ]);
    expect(result.value!.products.map((product) => product.id).sort()).toEqual(
      [fixture.productId, fixture.archivedProductId].sort(),
    );
    const product = result.value!.products.find((record) => record.id === fixture.productId)!;
    expect(product).toEqual(
      await new ProductFinder().find(fixture.db, { merchantId: fixture.merchantId, id: fixture.productId }),
    );
    expect(product).toMatchObject({
      name: "Nami's mandarins",
      price: "20.00",
      optionGroups: [{ name: "Crate size", options: [{ name: "Large" }] }],
      variants: [{ id: fixture.variantId, options: [{ name: "Large" }] }],
    });
    expect(
      product.variants[0].inventoryLevels.map((level) => level.onHand).sort((first, second) => first - second),
    ).toEqual([7, 12]);
    expect(result.value!.products.find((record) => record.id === fixture.archivedProductId)).toMatchObject({
      status: "archived",
      archivedAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(product).not.toHaveProperty("merchantId");
    expect(product.variants[0].inventoryLevels[0]).not.toHaveProperty("merchantId");
    expect(result.value).not.toHaveProperty("sales");
    expect(result.value).not.toHaveProperty("purchases");
    const keys = await infrastructure.cache!.keys(`sync:v1:${fixture.merchantId}:*`);
    expect(keys).toHaveLength(1);
    expect(await infrastructure.cache!.ttl(keys[0])).toBeGreaterThan(30 * 24 * 60 * 60 - 10);
  });

  it("returns empty arrays without changes, issues fresh tokens, and preserves retryable checkpoints", async () => {
    const { service } = await setup();
    const first = await service.execute({ syncToken: "*" });

    const second = await service.execute({ syncToken: first.value!.syncToken });
    const retry = await service.execute({ syncToken: first.value!.syncToken });

    expect(second.value).toMatchObject({
      fullSync: false,
      merchant: null,
      products: [],
      collections: [],
      customers: [],
      suppliers: [],
      locations: [],
      employees: [],
    });
    expect(retry.value).toMatchObject({
      fullSync: false,
      merchant: null,
      products: [],
      collections: [],
      customers: [],
      suppliers: [],
      locations: [],
      employees: [],
    });
    expect(second.value!.syncToken).not.toBe(first.value!.syncToken);
    expect(retry.value!.syncToken).not.toBe(second.value!.syncToken);
  });

  it("returns new and changed complete records while excluding unchanged and foreign records", async () => {
    const fixture = await setup();
    const first = await fixture.service.execute({ syncToken: "*" });
    const newCustomerId = generateId({ model: "customer" });
    await fixture.db
      .update(tables.collection)
      .set({ name: "Grand Line provisions" })
      .where(eq(tables.collection.id, fixture.collectionId));
    await fixture.db
      .update(tables.customer)
      .set({ phone: "+50588888888" })
      .where(eq(tables.customer.id, fixture.customerId));
    await fixture.db
      .update(tables.supplier)
      .set({ email: "sanji@strawhatpirates.example.com" })
      .where(eq(tables.supplier.id, fixture.supplierId));
    await fixture.db
      .update(tables.location)
      .set({ name: "Dressrosa" })
      .where(eq(tables.location.id, fixture.locationId));
    await fixture.db
      .update(tables.product)
      .set({ status: "archived", archivedAt: new Date("2026-02-01T00:00:00Z") })
      .where(eq(tables.product.id, fixture.productId));
    await fixture.db
      .insert(tables.customer)
      .values({ id: newCustomerId, merchantId: fixture.merchantId, name: "Roronoa Zoro" });
    await fixture.db
      .update(tables.customer)
      .set({ name: "Trafalgar Law" })
      .where(eq(tables.customer.id, fixture.foreign.customerId));

    const result = await fixture.service.execute({ syncToken: first.value!.syncToken });

    expect(result.value!.fullSync).toBe(false);
    expect(result.value!.products).toHaveLength(1);
    expect(result.value!.products[0]).toMatchObject({
      id: fixture.productId,
      status: "archived",
      variants: [{ id: fixture.variantId }],
      collection: { name: "Grand Line provisions" },
    });
    expect(result.value!.collections).toMatchObject([{ id: fixture.collectionId, name: "Grand Line provisions" }]);
    expect(result.value!.customers.map((record) => record.id).sort()).toEqual(
      [fixture.customerId, newCustomerId].sort(),
    );
    expect(result.value!.customers.find((record) => record.id === fixture.customerId)).toMatchObject({
      name: "Monkey D. Luffy",
      phone: "+50588888888",
    });
    expect(result.value!.suppliers).toMatchObject([
      { id: fixture.supplierId, name: "Sanji", email: "sanji@strawhatpirates.example.com" },
    ]);
    expect(result.value!.locations).toMatchObject([{ id: fixture.locationId, name: "Dressrosa" }]);
    const repeated = await fixture.service.execute({ syncToken: result.value!.syncToken });
    expect(repeated.value!.products).toEqual(result.value!.products);
    expect(repeated.value!.customers).toEqual(result.value!.customers);
  });

  it("returns only employees changed since the checkpoint with their location ids and never another merchant's", async () => {
    const fixture = await setup();
    const first = await fixture.service.execute({ syncToken: "*" });
    await fixture.db
      .update(tables.employee)
      .set({ status: "disabled" })
      .where(eq(tables.employee.id, fixture.employeeId));
    await fixture.db
      .update(tables.employee)
      .set({ status: "disabled" })
      .where(eq(tables.employee.id, fixture.foreign.employeeId));

    const result = await fixture.service.execute({ syncToken: first.value!.syncToken });

    expect(result.value!.employees).toMatchObject([
      { id: fixture.employeeId, status: "disabled", locationIds: [fixture.locationId] },
    ]);
  });

  it.each(["inventory", "variant", "option", "optionGroup", "image", "imageArchive", "collection"] as const)(
    "returns the complete affected product after an isolated %s change",
    async (change) => {
      const fixture = await setup();
      const before = await fixture.db.select().from(tables.product).where(eq(tables.product.id, fixture.productId));
      const first = await fixture.service.execute({ syncToken: "*" });
      if (change === "inventory") {
        await fixture.db
          .update(tables.inventoryLevel)
          .set({ onHand: 3 })
          .where(eq(tables.inventoryLevel.id, fixture.inventoryLevelId));
      }
      if (change === "variant") {
        await fixture.db.update(tables.variant).set({ price: "25.00" }).where(eq(tables.variant.id, fixture.variantId));
      }
      if (change === "option") {
        await fixture.db.update(tables.option).set({ name: "Small" }).where(eq(tables.option.id, fixture.optionId));
      }
      if (change === "optionGroup") {
        await fixture.db
          .update(tables.optionGroup)
          .set({ name: "Mandarin size" })
          .where(eq(tables.optionGroup.id, fixture.optionGroupId));
      }
      if (change === "imageArchive") {
        await fixture.db
          .update(tables.productImage)
          .set({ archivedAt: new Date() })
          .where(eq(tables.productImage.productId, fixture.productId));
      }
      if (change === "image") {
        await fixture.db.insert(tables.productImage).values({
          id: generateId({ model: "img" }),
          merchantId: fixture.merchantId,
          productId: fixture.productId,
          source: "remote",
          status: "available",
          remoteUrl: "https://strawhatpirates.example.com/mandarins.webp",
          activatedAt: new Date(),
        });
      }
      if (change === "collection") {
        await fixture.db
          .update(tables.collection)
          .set({ name: "Grand Line provisions" })
          .where(eq(tables.collection.id, fixture.collectionId));
      }

      const result = await fixture.service.execute({ syncToken: first.value!.syncToken });

      expect(result.value!.products).toHaveLength(1);
      expect(result.value!.products[0]).toEqual(
        await new ProductFinder().find(fixture.db, { merchantId: fixture.merchantId, id: fixture.productId }),
      );
      expect(result.value!.products[0].variants[0].inventoryLevels).toHaveLength(2);
      expect(await fixture.db.select().from(tables.product).where(eq(tables.product.id, fixture.productId))).toEqual(
        before,
      );
    },
  );

  it("keeps a later resource read in the same snapshot after a concurrent transaction commits", async () => {
    const fixture = await setup();
    const merchantRead = Promise.withResolvers<void>();
    const findMerchant = fixture.dependencies.merchantFinder.findForSync.bind(fixture.dependencies.merchantFinder);
    const findCustomers = fixture.dependencies.customerFinder.findForSync.bind(fixture.dependencies.customerFinder);
    vi.spyOn(fixture.dependencies.merchantFinder, "findForSync").mockImplementationOnce(
      async (transaction, criteria) => {
        const merchant = await findMerchant(transaction, criteria);
        merchantRead.resolve();
        return merchant;
      },
    );
    vi.spyOn(fixture.dependencies.customerFinder, "findForSync").mockImplementationOnce(
      async (transaction, criteria) => {
        await merchantRead.promise;
        await fixture.db.transaction(async (writer) => {
          await writer
            .update(tables.merchant)
            .set({ name: "Straw Hat Grand Fleet" })
            .where(eq(tables.merchant.id, fixture.merchantId));
          await writer
            .update(tables.customer)
            .set({ name: "Roronoa Zoro" })
            .where(eq(tables.customer.id, fixture.customerId));
        });
        return findCustomers(transaction, criteria);
      },
    );

    const during = await fixture.service.execute({ syncToken: "*" });
    const after = await fixture.service.execute({ syncToken: during.value!.syncToken });

    expect(during.value!.merchant!.name).toBe("Straw Hat Pirates");
    expect(during.value!.customers[0].name).toBe("Monkey D. Luffy");
    expect(after.value!.merchant!.name).toBe("Straw Hat Grand Fleet");
    expect(after.value!.customers[0].name).toBe("Roronoa Zoro");
  });

  it("does not lose an update whose transaction commits after a sync checkpoint", async () => {
    const fixture = await setup();
    const updated = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const writer = fixture.db.transaction(async (transaction) => {
      await transaction
        .update(tables.inventoryLevel)
        .set({ onHand: 2 })
        .where(eq(tables.inventoryLevel.id, fixture.inventoryLevelId));
      updated.resolve();
      await release.promise;
    });
    await updated.promise;

    const during = await fixture.service.execute({ syncToken: "*" }).finally(() => release.resolve());
    await writer;
    const after = await fixture.service.execute({ syncToken: during.value!.syncToken });

    expect(
      during
        .value!.products.find((product) => product.id === fixture.productId)!
        .variants[0].inventoryLevels.find((level) => level.id === fixture.inventoryLevelId)!.onHand,
    ).toBe(12);
    expect(after.value!.products).toHaveLength(1);
    expect(
      after.value!.products[0].variants[0].inventoryLevels.find((level) => level.id === fixture.inventoryLevelId)!
        .onHand,
    ).toBe(2);
  });

  it("falls back to full sync when an authentic checkpoint is evicted", async () => {
    const { service, merchantId } = await setup();
    const first = await service.execute({ syncToken: "*" });
    const keys = await infrastructure.cache!.keys(`sync:v1:${merchantId}:*`);
    await infrastructure.cache!.del(...keys);

    const result = await service.execute({ syncToken: first.value!.syncToken });

    expect(result.value).toMatchObject({ fullSync: true, products: expect.any(Array) });
    expect(result.value!.products).toHaveLength(2);
  });

  it("expires tokens after 30 days while preserving newer tokens", async () => {
    const { service } = await setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    const issuedAt = new Date();
    vi.setSystemTime(issuedAt);
    const first = await service.execute({ syncToken: "*" });
    vi.setSystemTime(new Date(issuedAt.getTime() + 29 * 24 * 60 * 60 * 1000));
    const newer = await service.execute({ syncToken: first.value!.syncToken });
    vi.setSystemTime(new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000));

    const expired = await service.execute({ syncToken: first.value!.syncToken });
    const valid = await service.execute({ syncToken: newer.value!.syncToken });

    expect(expired.value!.fullSync).toBe(true);
    expect(expired.value!.products).toHaveLength(2);
    expect(valid.value).toMatchObject({
      fullSync: false,
      merchant: null,
      products: [],
      collections: [],
      customers: [],
      suppliers: [],
      locations: [],
    });
  });

  it("rejects malformed, tampered, and foreign-merchant tokens even after cache eviction", async () => {
    const fixture = await setup();
    const first = await fixture.service.execute({ syncToken: "*" });
    await infrastructure.cache!.flushdb();
    const token = first.value!.syncToken;
    const tampered = `${token[0] === "A" ? "B" : "A"}${token.slice(1)}`;
    const foreignService = IncrementalSyncService.create({
      ...fixture.dependencies,
      user: { ...fixture.dependencies.user, merchantId: fixture.foreignMerchantId },
    });

    const malformed = await fixture.service.execute({ syncToken: "not-a-sync-token" });
    const invalidSignature = await fixture.service.execute({ syncToken: tampered });
    const foreign = await foreignService.execute({ syncToken: token });

    for (const result of [malformed, invalidSignature, foreign])
      expect(result).toMatchObject({ success: false, error: { code: "sync_token_invalid" } });
    expect(await infrastructure.cache!.keys("sync:v1:*")).toEqual([]);
  });

  it("returns an availability error without a new token when Redis reads or writes are unavailable", async () => {
    const fixture = await setup();
    const first = await fixture.service.execute({ syncToken: "*" });
    const unavailableCache = new Redis(infrastructure.container!.getConnectionUrl(), {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
    });
    unavailableCache.disconnect();
    const service = IncrementalSyncService.create({ ...fixture.dependencies, cache: unavailableCache });

    const read = await service.execute({ syncToken: first.value!.syncToken });
    const write = await service.execute({ syncToken: "*" });

    expect(read).toMatchObject({ success: false, error: { code: "sync_unavailable" } });
    expect(write).toMatchObject({ success: false, error: { code: "sync_unavailable" } });
    expect(read).not.toHaveProperty("value");
    expect(write).not.toHaveProperty("value");
    expect((await fixture.service.execute({ syncToken: first.value!.syncToken })).value!.fullSync).toBe(false);
  });

  it("does not publish a checkpoint after a database query failure", async () => {
    const fixture = await setup();
    const first = await fixture.service.execute({ syncToken: "*" });
    const keysBefore = await infrastructure.cache!.keys("sync:v1:*");
    vi.spyOn(ProductFinder.prototype, "findForSync").mockRejectedValueOnce(new Error("MySQL unavailable"));

    await expect(fixture.service.execute({ syncToken: first.value!.syncToken })).rejects.toThrow("MySQL unavailable");

    expect(await infrastructure.cache!.keys("sync:v1:*")).toEqual(keysBefore);
    const retry = await fixture.service.execute({ syncToken: first.value!.syncToken });
    expect(retry.value).toMatchObject({
      fullSync: false,
      merchant: null,
      products: [],
      collections: [],
      customers: [],
      suppliers: [],
      locations: [],
    });
  });

  it("returns the entire catalog even when it exceeds 5,000 products", async () => {
    const fixture = await setup();
    await fixture.db.insert(tables.product).values(
      Array.from({ length: 5001 }, (_, index) => {
        const id = generateId({ model: "product" });
        return {
          id,
          merchantId: fixture.merchantId,
          name: `East Blue provision ${index}`,
          slug: id,
          price: "20.00",
          unitCost: "10.00",
        };
      }),
    );

    const result = await fixture.service.execute({ syncToken: "*" });

    expect(result.value!.fullSync).toBe(true);
    expect(result.value!.products).toHaveLength(5003);
    expect(result.value).not.toHaveProperty("skippedResources");
    expect(result.value).not.toHaveProperty("nextCursor");
  });

  it.each(["redis", "database"] as const)(
    "maps a %s outage through the full HTTP middleware stack without issuing a token",
    async (dependency) => {
      const fixture = await setup();
      const { env, logger, user } = fixture.dependencies;
      const externalId = "clerk_nami";
      await fixture.db
        .insert(tables.account)
        .values({ id: user.id, merchantId: fixture.merchantId, externalId, email: user.email });
      await fixture.db.insert(tables.employee).values({
        id: user.employeeId,
        merchantId: fixture.merchantId,
        accountId: user.id,
        name: "Nami",
        status: "enabled",
        isOwner: false,
        pin: "4821",
      });
      const identity = new IdentityProvider(logger, env);
      vi.spyOn(identity, "verifyToken").mockResolvedValue(
        ok({ sub: externalId, email: user.email, merchantId: fixture.merchantId, accountType: "staff" }),
      );
      const unavailableCache = new Redis(infrastructure.container!.getConnectionUrl(), {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
      });
      unavailableCache.disconnect();
      if (dependency === "database") {
        vi.spyOn(ProductFinder.prototype, "findForSync").mockRejectedValueOnce(new Error("MySQL unavailable"));
      }
      const app = createApp({
        ...fixture.dependencies,
        cache: dependency === "redis" ? unavailableCache : fixture.dependencies.cache,
        identity,
        emailSender: new EmailSender({ env, logger }),
        employeeManagement: new EmployeeManagement(),
        inventoryManagement: new InventoryManagement(),
        productImageStore: new ProductImageStore({ env, logger }),
        publisher: new RealtimeEventPublisher({ env, logger }),
        merchantFinder: new MerchantFinder(),
        collectionFinder: new CollectionFinder(),
        customerFinder: new CustomerFinder(),
        invitationFinder: new InvitationFinder(),
        locationFinder: new LocationFinder(),
        supplierFinder: new SupplierFinder(),
        productFinder: new ProductFinder(),
        purchaseFinder: new PurchaseFinder(),
        saleFinder: new SaleFinder(),
      });

      const response = await app.request("/v1/sync", {
        method: "POST",
        headers: { Authorization: "Bearer nami-token", "Content-Type": "application/json" },
        body: JSON.stringify({ sync_token: "*" }),
      });

      expect(response.status).toBe(dependency === "redis" ? 503 : 500);
      expect(response.headers.get("content-type")).toContain("application/json");
      const body = await response.json();
      expect(body).toMatchObject({
        code: dependency === "redis" ? "sync_unavailable" : "internal_server_error",
        request_id: expect.any(String),
      });
      expect(body).not.toHaveProperty("sync_token");
      expect(await infrastructure.cache!.keys(`sync:v1:${fixture.merchantId}:*`)).toEqual([]);
    },
  );
});
