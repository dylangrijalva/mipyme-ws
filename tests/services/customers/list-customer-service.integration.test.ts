import pino from "pino";
import { describe, expect, it } from "vitest";
import { tables } from "../../../src/db/schema.ts";
import { CustomerFinder } from "../../../src/finders/customer-finder.ts";
import { ListCustomersService } from "../../../src/services/customers/list-customer-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { ok } from "../../../src/utils/result.ts";
import { prepareDatabase } from "../../prepare-db.ts";

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  const service = ListCustomersService.create({
    db,
    customerFinder: new CustomerFinder(),
    logger: pino({ enabled: false }),
    user: {
      id: "luffy",
      employeeId: "sanji",
      email: "sanji@strawhatpirates.example.com",
      accountType: "owner",
      merchantId,
    },
  });
  return { db, service, merchantId, otherMerchantId };
}

describe("ListCustomersService", () => {
  it("returns ordered cursor pages excluding foreign customers, then an empty final page", async () => {
    const { db, service, merchantId, otherMerchantId } = await setup();
    const firstId = "cust_0000000000000000001";
    const foreignId = "cust_0000000000000000002";
    const lastId = "cust_0000000000000000003";
    const timestamp = new Date("2026-01-01T00:00:00Z");
    await db.insert(tables.customer).values([
      { id: lastId, merchantId, name: "Tony Tony Chopper", createdAt: timestamp, updatedAt: timestamp },
      { id: foreignId, merchantId: otherMerchantId, name: "Trafalgar Law" },
      { id: firstId, merchantId, name: "Nico Robin", createdAt: timestamp, updatedAt: timestamp },
    ]);

    const first = await service.execute({ limit: 1 });
    const last = await service.execute({ limit: 1, cursor: firstId });
    const empty = await service.execute({ limit: 1, cursor: lastId });

    expect(first).toEqual(
      ok({
        results: [
          { id: firstId, name: "Nico Robin", email: null, phone: null, createdAt: timestamp, updatedAt: timestamp },
        ],
        nextCursor: firstId,
        hasMore: true,
      }),
    );
    expect(last).toEqual(
      ok({
        results: [
          {
            id: lastId,
            name: "Tony Tony Chopper",
            email: null,
            phone: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
        nextCursor: null,
        hasMore: false,
      }),
    );
    expect(empty).toEqual(ok({ results: [], nextCursor: null, hasMore: false }));
  });

  it("returns an empty page when only another merchant has customers", async () => {
    const { db, service, otherMerchantId } = await setup();
    await db
      .insert(tables.customer)
      .values({ id: generateId({ model: "customer" }), merchantId: otherMerchantId, name: "Trafalgar Law" });

    const result = await service.execute({ limit: 50 });

    expect(result).toEqual(ok({ results: [], nextCursor: null, hasMore: false }));
  });
});
