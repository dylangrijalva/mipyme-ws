import pino from "pino";
import { describe, expect, it } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import { tables } from "../../../src/db/schema.ts";
import { CollectionFinder } from "../../../src/finders/collection-finder.ts";
import { FindCollectionService } from "../../../src/services/catalog/collections/find-collection-service.ts";
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
  const service = FindCollectionService.create({
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

describe("FindCollectionService", () => {
  it("returns the current merchant's collection without leaking merchant metadata", async () => {
    const { db, merchantId, service } = await setup();
    const id = generateId({ model: "collection" });
    await db.insert(tables.collection).values({ id, merchantId, name: "Thousand Sunny", slug: "thousand-sunny" });

    const result = await service.execute(id);

    expect(result).toMatchObject({
      success: true,
      value: {
        id,
        name: "Thousand Sunny",
        slug: "thousand-sunny",
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      },
    });
    expect(result.value).not.toHaveProperty("merchantId");
  });

  it("returns not found for foreign and missing collections", async () => {
    const { db, otherMerchantId, service } = await setup();
    const foreignId = generateId({ model: "collection" });
    await db
      .insert(tables.collection)
      .values({ id: foreignId, merchantId: otherMerchantId, name: "Polar Tang", slug: "polar-tang" });

    for (const id of [foreignId, generateId({ model: "collection" })]) {
      const result = await service.execute(id);

      expect(result).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    }
  });
});
