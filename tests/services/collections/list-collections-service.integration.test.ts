import pino from "pino";
import { describe, expect, it } from "vitest";
import { tables } from "../../../src/db/schema.ts";
import { CollectionFinder } from "../../../src/finders/collection-finder.ts";
import { ListCollectionsService } from "../../../src/services/catalog/collections/list-collections-service.ts";
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
  const service = ListCollectionsService.create({
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

describe("ListCollectionsService", () => {
  it("returns ordered cursor pages excluding collections from another merchant", async () => {
    const { db, merchantId, otherMerchantId, service } = await setup();
    const ids = [
      generateId({ model: "collection" }),
      generateId({ model: "collection" }),
      generateId({ model: "collection" }),
    ].sort();
    await db.insert(tables.collection).values([
      { id: ids[2], merchantId, name: "Wano Country", slug: "wano-country" },
      { id: ids[0], merchantId, name: "Water 7", slug: "water-7" },
      { id: ids[1], merchantId, name: "Alabasta", slug: "alabasta" },
      { id: generateId({ model: "collection" }), merchantId: otherMerchantId, name: "Polar Tang", slug: "polar-tang" },
    ]);

    const first = await service.execute({ limit: 2 });
    const final = await service.execute({ limit: 2, cursor: first.value!.nextCursor! });

    expect(first.value).toMatchObject({
      results: [
        { id: ids[0], name: "Water 7" },
        { id: ids[1], name: "Alabasta" },
      ],
      hasMore: true,
      nextCursor: ids[1],
    });
    expect(final.value).toMatchObject({
      results: [{ id: ids[2], name: "Wano Country" }],
      hasMore: false,
      nextCursor: null,
    });
    expect(first.value!.results[0]).not.toHaveProperty("merchantId");
  });

  it("returns an empty terminal page for an empty merchant and a cursor after the final collection", async () => {
    const { db, merchantId, otherMerchantId, service } = await setup();
    await db.insert(tables.collection).values({
      id: generateId({ model: "collection" }),
      merchantId: otherMerchantId,
      name: "Polar Tang",
      slug: "polar-tang",
    });

    const empty = await service.execute({ limit: 2 });

    expect(empty.value).toEqual({ results: [], hasMore: false, nextCursor: null });
    const id = generateId({ model: "collection" });
    await db.insert(tables.collection).values({ id, merchantId, name: "Water 7", slug: "water-7" });
    const afterFinal = await service.execute({ limit: 2, cursor: id });
    expect(afterFinal.value).toEqual({ results: [], hasMore: false, nextCursor: null });
  });
});
