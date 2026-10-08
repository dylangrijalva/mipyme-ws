import { eq } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import { tables } from "../../../src/db/schema.ts";
import { CollectionFinder } from "../../../src/finders/collection-finder.ts";
import {
  CreateCollectionRequest,
  CreateCollectionService,
} from "../../../src/services/collections/create-collection-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  const collectionFinder = new CollectionFinder();
  const service = CreateCollectionService.create({
    db,
    collectionFinder,
    logger: pino({ enabled: false }),
    user: {
      id: "luffy",
      employeeId: "sanji",
      email: "sanji@strawhatpirates.example.com",
      accountType: "owner",
      merchantId,
    },
  });
  return { db, merchantId, otherMerchantId, service, collectionFinder };
}

describe("CreateCollectionService", () => {
  it("persists a trimmed name and generated slug while allowing another merchant's name", async () => {
    const { db, merchantId, otherMerchantId, service } = await setup();
    const foreignId = generateId({ model: "collection" });
    await db
      .insert(tables.collection)
      .values({ id: foreignId, merchantId: otherMerchantId, name: "Water 7", slug: "water-7" });
    const before = await db.select().from(tables.collection).where(eq(tables.collection.id, foreignId));

    const result = await service.execute(CreateCollectionRequest.parse({ name: "  Water 7  " }));

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({
      name: "Water 7",
      slug: "water-7",
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(await db.select().from(tables.collection).where(eq(tables.collection.id, result.value!.id))).toMatchObject([
      { merchantId, name: "Water 7", slug: "water-7" },
    ]);
    expect(await db.select().from(tables.collection).where(eq(tables.collection.id, foreignId))).toEqual(before);
  });

  it("rejects a normalized duplicate name without changing stored collections", async () => {
    const { db, merchantId, service } = await setup();
    await db
      .insert(tables.collection)
      .values({ id: generateId({ model: "collection" }), merchantId, name: "Water 7", slug: "water-7" });
    const before = await db.select().from(tables.collection);

    const result = await service.execute(CreateCollectionRequest.parse({ name: "  WATER 7 " }));

    expect(result).toMatchObject({ success: false, error: { code: codes.collectionNameAlreadyExists } });
    expect(await db.select().from(tables.collection)).toEqual(before);
  });

  it("lets a database uniqueness error reject one simultaneous create while persisting the other", async () => {
    const { db, service, collectionFinder } = await setup();
    const exists = collectionFinder.exists.bind(collectionFinder);
    const barrier = Promise.withResolvers<void>();
    const completedReads: Array<boolean> = [];
    const coordinatedReads = vi.spyOn(collectionFinder, "exists").mockImplementation(async (database, criteria) => {
      const result = await exists(database, criteria);
      completedReads.push(result);
      if (completedReads.length === 2) {
        barrier.resolve();
      }
      await barrier.promise;
      return result;
    });

    const results = await Promise.allSettled([
      service.execute({ name: "Dressrosa" }),
      service.execute({ name: "Dressrosa" }),
    ]);

    coordinatedReads.mockRestore();
    expect(completedReads).toEqual([false, false]);
    expect(results.filter((result) => result.status === "fulfilled")).toMatchObject([
      { status: "fulfilled", value: { success: true, value: { name: "Dressrosa", slug: "dressrosa" } } },
    ]);
    expect(results.filter((result) => result.status === "rejected")).toMatchObject([
      { status: "rejected", reason: { cause: { code: "ER_DUP_ENTRY" } } },
    ]);
    expect(await db.select().from(tables.collection)).toMatchObject([{ name: "Dressrosa", slug: "dressrosa" }]);
  });
});
