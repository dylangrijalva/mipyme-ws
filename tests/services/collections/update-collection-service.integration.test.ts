import { eq, ne } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import { tables } from "../../../src/db/schema.ts";
import { CollectionFinder } from "../../../src/finders/collection-finder.ts";
import {
  UpdateCollectionService,
  UpdateCollectionRequest,
} from "../../../src/services/catalog/collections/update-collection-service.ts";
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
  const service = UpdateCollectionService.create({
    publisher,
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
  return { broadcast, db, merchantId, otherMerchantId, service, collectionFinder };
}

describe("UpdateCollectionService", () => {
  it("renames a collection and regenerates its slug while leaving unrelated collections unchanged", async () => {
    const { broadcast, db, merchantId, otherMerchantId, service } = await setup();
    const id = generateId({ model: "collection" });
    const otherId = generateId({ model: "collection" });
    const siblingId = generateId({ model: "collection" });
    await db.insert(tables.collection).values([
      { id, merchantId, name: "Water 7", slug: "water-7" },
      { id: siblingId, merchantId, name: "Wano Country", slug: "wano-country" },
      { id: otherId, merchantId: otherMerchantId, name: "Alabasta", slug: "alabasta" },
    ]);
    const before = await db
      .select()
      .from(tables.collection)
      .where(ne(tables.collection.id, id))
      .orderBy(tables.collection.id);

    const result = await service.execute([id, UpdateCollectionRequest.parse({ name: "  Alabasta  " })]);

    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "collection", snapshot: result.value },
    });

    expect(result.value).toMatchObject({ id, name: "Alabasta", slug: "alabasta" });
    expect(await db.select().from(tables.collection).where(eq(tables.collection.id, id))).toMatchObject([
      { name: "Alabasta", slug: "alabasta" },
    ]);
    expect(
      await db.select().from(tables.collection).where(ne(tables.collection.id, id)).orderBy(tables.collection.id),
    ).toEqual(before);
  });

  it("rejects a conflicting rename without changing either collection", async () => {
    const { db, merchantId, service } = await setup();
    const id = generateId({ model: "collection" });
    await db.insert(tables.collection).values([
      { id, merchantId, name: "Water 7", slug: "water-7" },
      { id: generateId({ model: "collection" }), merchantId, name: "Alabasta", slug: "alabasta" },
    ]);
    const before = await db.select().from(tables.collection).orderBy(tables.collection.id);

    const result = await service.execute([id, { name: "ALABASTA" }]);

    expect(result).toMatchObject({ success: false, error: { code: codes.collectionNameAlreadyExists } });
    expect(await db.select().from(tables.collection).orderBy(tables.collection.id)).toEqual(before);
  });

  it("allows its existing slug and leaves an empty patch unchanged", async () => {
    const { broadcast, db, merchantId, service } = await setup();
    const id = generateId({ model: "collection" });
    await db.insert(tables.collection).values({ id, merchantId, name: "Water 7", slug: "water-7" });

    const rename = await service.execute([id, { name: "WATER 7" }]);

    expect(rename.value).toMatchObject({ id, name: "WATER 7", slug: "water-7" });
    const before = await db.select().from(tables.collection);
    broadcast.mockClear();
    const noop = await service.execute([id, {}]);

    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "collection", snapshot: noop.value },
    });
    expect(noop.value).toEqual(rename.value);
    expect(await db.select().from(tables.collection)).toEqual(before);
  });

  it("returns not found for foreign and missing collections without changing records", async () => {
    const { db, otherMerchantId, service } = await setup();
    const foreignId = generateId({ model: "collection" });
    await db
      .insert(tables.collection)
      .values({ id: foreignId, merchantId: otherMerchantId, name: "Polar Tang", slug: "polar-tang" });
    const before = await db.select().from(tables.collection);

    for (const id of [foreignId, generateId({ model: "collection" })]) {
      const result = await service.execute([id, { name: "Marineford" }]);

      expect(result).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    }
    expect(await db.select().from(tables.collection)).toEqual(before);
  });
});
