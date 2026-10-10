import { describe, expect, it } from "vitest";
import { tables } from "../../src/db/schema.ts";
import { CollectionFinder } from "../../src/finders/collection-finder.ts";
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
  return { db, merchantId, otherMerchantId, collectionId };
}

describe("CollectionFinder", () => {
  it("finds and checks collections by id and slug within the merchant", async () => {
    const { db, merchantId, otherMerchantId, collectionId } = await setup();
    await db.insert(tables.collection).values({
      id: generateId({ model: "collection" }),
      merchantId: otherMerchantId,
      name: "Polar Tang",
      slug: "provisions",
    });
    const finder = new CollectionFinder();

    const found = await finder.find(db, { merchantId, slug: "provisions" });
    const exists = await finder.exists(db, { merchantId, id: collectionId });
    const existsByIdAndSlug = await finder.exists(db, { merchantId, id: collectionId, slug: "provisions" });
    const mismatched = { merchantId, id: collectionId, slug: "polar-tang" };
    const missingId = { merchantId, id: "missing", slug: "provisions" };
    const missing = { merchantId, slug: "missing" };

    expect(found).toMatchObject({ id: collectionId, name: "Provisions", slug: "provisions" });
    expect(exists).toBe(true);
    expect(existsByIdAndSlug).toBe(true);
    for (const criteria of [mismatched, missingId, missing, { merchantId: otherMerchantId, id: collectionId }]) {
      expect(await finder.find(db, criteria)).toBeNull();
      expect(await finder.exists(db, criteria)).toBe(false);
    }
    expect((await finder.find(db, { merchantId: otherMerchantId, slug: "provisions" }))?.name).toBe("Polar Tang");
  });

  it("paginates uncommitted collections with scoped ordered pages and exclusive cursors", async () => {
    const { db, merchantId, otherMerchantId } = await setup();
    const firstId = "coll_0000000000000000001";
    const lastId = "coll_0000000000000000003";
    await db.delete(tables.collection);
    await db.insert(tables.collection).values({
      id: "coll_0000000000000000002",
      merchantId: otherMerchantId,
      name: "Polar Tang",
      slug: "polar-tang",
    });
    const finder = new CollectionFinder();

    const pages = await db.transaction(async (transaction) => {
      const beforeInsert = await finder.paginate(transaction, { merchantId, limit: 2 });
      await transaction.insert(tables.collection).values([
        { id: lastId, merchantId, name: "Wano", slug: "wano" },
        { id: firstId, merchantId, name: "Water 7", slug: "water-7" },
      ]);
      return {
        beforeInsert,
        first: await finder.paginate(transaction, { merchantId, limit: 1 }),
        full: await finder.paginate(transaction, { merchantId, limit: 2 }),
        afterFirst: await finder.paginate(transaction, { merchantId, limit: 1, cursor: firstId }),
        afterGap: await finder.paginate(transaction, { merchantId, limit: 1, cursor: "coll_0000000000000000002" }),
        empty: await finder.paginate(transaction, { merchantId, limit: 2, cursor: lastId }),
      };
    });

    expect(pages.beforeInsert).toEqual({ results: [], hasMore: false, nextCursor: null });
    expect(pages.first.results.map((collection) => collection.id)).toEqual([firstId]);
    expect(pages.first).toMatchObject({ hasMore: true, nextCursor: firstId });
    expect(pages.full.results.map((collection) => collection.id)).toEqual([firstId, lastId]);
    expect(pages.full).toMatchObject({
      hasMore: false,
      nextCursor: null,
      results: [{ slug: "water-7" }, { slug: "wano" }],
    });
    expect(pages.afterGap.results.map((collection) => collection.id)).toEqual([lastId]);
    expect(pages.afterGap).toMatchObject({ hasMore: false, nextCursor: null });
    expect(pages.afterFirst.results.map((collection) => collection.id)).toEqual([lastId]);
    expect(pages.afterFirst).toMatchObject({ hasMore: false, nextCursor: null });
    expect(pages.empty).toEqual({ results: [], hasMore: false, nextCursor: null });
  });
});
