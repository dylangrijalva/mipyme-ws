import { describe, expect, it } from "vitest";
import { tables } from "../../src/db/schema.ts";
import { CustomerFinder } from "../../src/finders/customer-finder.ts";
import { generateId } from "../../src/utils/generate-id.ts";
import { prepareDatabase } from "../prepare-db.ts";

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  return { db, merchantId, otherMerchantId };
}

describe("CustomerFinder", () => {
  it("reads uncommitted customer contacts and returns null for missing or foreign ids", async () => {
    const { db, merchantId, otherMerchantId } = await setup();
    const id = generateId({ model: "customer" });
    const foreignId = generateId({ model: "customer" });
    const timestamp = new Date("2026-01-01T00:00:00Z");
    await db.insert(tables.customer).values({ id: foreignId, merchantId: otherMerchantId, name: "Bepo" });
    const finder = new CustomerFinder();

    const result = await db.transaction(async (transaction) => {
      await transaction.insert(tables.customer).values({
        id,
        merchantId,
        name: "Nico Robin",
        email: "robin@strawhatpirates.example.com",
        phone: "50512345678",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return {
        found: await finder.find(transaction, { merchantId, id }),
        missing: await finder.find(transaction, { merchantId, id: "missing" }),
        foreign: await finder.find(transaction, { merchantId, id: foreignId }),
      };
    });

    expect(result.found).toEqual({
      id,
      name: "Nico Robin",
      email: "robin@strawhatpirates.example.com",
      phone: "50512345678",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(result.missing).toBeNull();
    expect(result.foreign).toBeNull();
  });

  it("paginates uncommitted records with scoped ordered pages and exclusive cursors", async () => {
    const { db, merchantId, otherMerchantId } = await setup();
    const firstId = "cust_0000000000000000001";
    const lastId = "cust_0000000000000000003";
    const timestamp = new Date("2026-01-01T00:00:00Z");
    await db
      .insert(tables.customer)
      .values({ id: "cust_0000000000000000002", merchantId: otherMerchantId, name: "Bepo" });
    const finder = new CustomerFinder();

    const pages = await db.transaction(async (transaction) => {
      const beforeInsert = await finder.paginate(transaction, { merchantId, limit: 2 });
      await transaction.insert(tables.customer).values([
        { id: lastId, merchantId, name: "Sanji", createdAt: timestamp, updatedAt: timestamp },
        { id: firstId, merchantId, name: "Nico Robin", createdAt: timestamp, updatedAt: timestamp },
      ]);
      return {
        beforeInsert,
        first: await finder.paginate(transaction, { merchantId, limit: 1 }),
        full: await finder.paginate(transaction, { merchantId, limit: 2 }),
        afterFirst: await finder.paginate(transaction, { merchantId, limit: 1, cursor: firstId }),
        afterGap: await finder.paginate(transaction, { merchantId, limit: 1, cursor: "cust_0000000000000000002" }),
        empty: await finder.paginate(transaction, { merchantId, limit: 2, cursor: lastId }),
      };
    });

    expect(pages.beforeInsert).toEqual({ results: [], hasMore: false, nextCursor: null });
    expect(pages.first).toEqual({
      results: [
        { id: firstId, name: "Nico Robin", email: null, phone: null, createdAt: timestamp, updatedAt: timestamp },
      ],
      hasMore: true,
      nextCursor: firstId,
    });
    expect(pages.full).toEqual({
      results: [
        { id: firstId, name: "Nico Robin", email: null, phone: null, createdAt: timestamp, updatedAt: timestamp },
        { id: lastId, name: "Sanji", email: null, phone: null, createdAt: timestamp, updatedAt: timestamp },
      ],
      hasMore: false,
      nextCursor: null,
    });
    expect(pages.afterGap).toEqual({
      results: [{ id: lastId, name: "Sanji", email: null, phone: null, createdAt: timestamp, updatedAt: timestamp }],
      hasMore: false,
      nextCursor: null,
    });
    expect(pages.afterFirst).toEqual({
      results: [{ id: lastId, name: "Sanji", email: null, phone: null, createdAt: timestamp, updatedAt: timestamp }],
      hasMore: false,
      nextCursor: null,
    });
    expect(pages.empty).toEqual({ results: [], hasMore: false, nextCursor: null });
  });
});
