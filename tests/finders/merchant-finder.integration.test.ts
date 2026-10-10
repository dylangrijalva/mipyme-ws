import { describe, expect, it } from "vitest";
import { tables } from "../../src/db/schema.ts";
import { MerchantFinder } from "../../src/finders/merchant-finder.ts";
import { generateId } from "../../src/utils/generate-id.ts";
import { prepareDatabase } from "../prepare-db.ts";

describe("MerchantFinder", () => {
  it("finds the requested merchant inside a transaction and returns null for a missing id", async () => {
    const db = await prepareDatabase();
    const id = generateId({ model: "merchant" });
    const timestamp = new Date("2026-01-01T00:00:00Z");
    await db.insert(tables.merchant).values({ id: generateId({ model: "merchant" }), name: "Heart Pirates" });
    const finder = new MerchantFinder();

    const result = await db.transaction(async (transaction) => {
      await transaction.insert(tables.merchant).values({
        id,
        name: "Straw Hat Pirates",
        country: "ni",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return {
        found: await finder.find(transaction, id),
        missing: await finder.find(transaction, "missing"),
      };
    });

    expect(result.found).toEqual({
      id,
      name: "Straw Hat Pirates",
      country: "ni",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(result.missing).toBeNull();
  });
});
