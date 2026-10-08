import pino from "pino";
import { describe, expect, it } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import { tables } from "../../../src/db/schema.ts";
import { CustomerFinder } from "../../../src/finders/customer-finder.ts";
import { FindCustomerService } from "../../../src/services/customers/find-customer-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { err, ok } from "../../../src/utils/result.ts";
import { prepareDatabase } from "../../prepare-db.ts";

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  const service = FindCustomerService.create({
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

describe("FindCustomerService", () => {
  it("returns the requested customer with nullable contacts without exposing merchant ownership", async () => {
    const { db, service, merchantId } = await setup();
    const id = generateId({ model: "customer" });
    const timestamp = new Date("2026-01-01T00:00:00Z");
    await db
      .insert(tables.customer)
      .values({ id, merchantId, name: "Nico Robin", createdAt: timestamp, updatedAt: timestamp });

    const result = await service.execute(id);

    expect(result).toEqual(
      ok({ id, name: "Nico Robin", email: null, phone: null, createdAt: timestamp, updatedAt: timestamp }),
    );
  });

  it.each(["missing", "foreign"])("returns resource-not-found for a %s customer", async (scenario) => {
    const { db, service, merchantId, otherMerchantId } = await setup();
    const id = generateId({ model: "customer" });
    await db.insert(tables.customer).values({ id: generateId({ model: "customer" }), merchantId, name: "Nico Robin" });
    if (scenario === "foreign") {
      await db.insert(tables.customer).values({ id, merchantId: otherMerchantId, name: "Trafalgar Law" });
    }

    const result = await service.execute(id);

    expect(result).toEqual(
      err({ code: codes.resourceNotFound, message: `Customer ${id} has not been found.`, details: [] }),
    );
  });
});
