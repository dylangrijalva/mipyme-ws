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
  it("finds a collection by merchant and id and returns null and false for missing or foreign collections", async () => {
    const { db, merchantId, otherMerchantId, collectionId } = await setup();
    const finder = new CollectionFinder();

    const collection = await finder.find(db, { merchantId, id: collectionId });

    expect(collection).toMatchObject({ id: collectionId, name: "Provisions", slug: "provisions" });
    expect(await finder.exists(db, { merchantId, id: collectionId })).toBe(true);
    for (const criteria of [
      { merchantId: otherMerchantId, id: collectionId },
      { merchantId, id: "missing" },
    ]) {
      expect(await finder.find(db, criteria)).toBeNull();
      expect(await finder.exists(db, criteria)).toBe(false);
    }
  });
});
