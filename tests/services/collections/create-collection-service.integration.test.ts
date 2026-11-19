import { eq } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import type { Database } from "../../../src/db/index.ts";
import { tables } from "../../../src/db/schema.ts";
import { CollectionFinder } from "../../../src/finders/collection-finder.ts";
import {
  CreateCollectionRequest,
  CreateCollectionService,
} from "../../../src/services/catalog/collections/create-collection-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import { createRealtimeEventPublisherMock } from "../../test-utils/realtime-publisher-mock.ts";

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  const collectionFinder = new CollectionFinder();
  const { broadcast, publisher } = createRealtimeEventPublisherMock();
  const createService = (database: Database) =>
    CreateCollectionService.create({
      publisher,
      db: database,
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
  return { broadcast, db, merchantId, otherMerchantId, service: createService(db), createService };
}

describe("CreateCollectionService", () => {
  it("persists a trimmed name and generated slug while allowing another merchant's name", async () => {
    const { broadcast, db, merchantId, otherMerchantId, service } = await setup();
    const foreignId = generateId({ model: "collection" });
    await db
      .insert(tables.collection)
      .values({ id: foreignId, merchantId: otherMerchantId, name: "Water 7", slug: "water-7" });
    const before = await db.select().from(tables.collection).where(eq(tables.collection.id, foreignId));

    const result = await service.execute(CreateCollectionRequest.parse({ name: "  Water 7  " }));

    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "collection", snapshot: result.value },
    });

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

  it("rejects a normalized name claimed after the create's snapshot without storing or publishing a duplicate", async () => {
    const { db, merchantId, createService, broadcast } = await setup();
    const winner = { id: generateId({ model: "collection" }), merchantId, name: "Water 7", slug: "water-7" };

    const { result, before } = await db.transaction(
      async (transaction) => {
        // A consistent read establishes the snapshot before the competing request commits.
        await transaction.select({ id: tables.collection.id }).from(tables.collection).limit(1);
        await db.insert(tables.collection).values(winner);
        const before = await db.select().from(tables.collection).orderBy(tables.collection.id);
        const result = await createService(transaction).execute(CreateCollectionRequest.parse({ name: "  WATER 7 " }));
        return { result, before };
      },
      { isolationLevel: "repeatable read" },
    );

    expect(result).toMatchObject({ success: false, error: { code: codes.collectionNameAlreadyExists } });
    expect(await db.select().from(tables.collection).orderBy(tables.collection.id)).toEqual(before);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
