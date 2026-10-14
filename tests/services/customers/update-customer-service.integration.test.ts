import { eq, ne } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import { tables } from "../../../src/db/schema.ts";
import { CustomerFinder } from "../../../src/finders/customer-finder.ts";
import {
  UpdateCustomerRequest,
  UpdateCustomerService,
} from "../../../src/services/customers/update-customer-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { err } from "../../../src/utils/result.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import { createBroadcastMock } from "../../test-utils/realtime-publisher-mock.ts";

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  const broadcast = createBroadcastMock();
  const service = UpdateCustomerService.create({
    publisher: { broadcast },
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
  return { broadcast, db, service, merchantId, otherMerchantId };
}

describe("UpdateCustomerService", () => {
  it("persists supplied fields while preserving omitted fields, ownership, and unrelated customers", async () => {
    const { broadcast, db, service, merchantId, otherMerchantId } = await setup();
    const id = generateId({ model: "customer" });
    const otherId = generateId({ model: "customer" });
    const foreignId = generateId({ model: "customer" });
    const createdAt = new Date("2026-01-01T00:00:00Z");
    await db.insert(tables.customer).values([
      {
        id,
        merchantId,
        name: "Nico Robin",
        email: "robin@strawhatpirates.example.com",
        phone: "50588888888",
        createdAt,
      },
      { id: otherId, merchantId, name: "Tony Tony Chopper" },
      { id: foreignId, merchantId: otherMerchantId, name: "Trafalgar Law" },
    ]);
    const unrelatedBefore = await db
      .select()
      .from(tables.customer)
      .where(ne(tables.customer.id, id))
      .orderBy(tables.customer.id);
    const request = UpdateCustomerRequest.parse({ name: "  Robin  ", phone: "  50599999999  " });

    const result = await service.execute([id, request]);

    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "customer", snapshot: result.value },
    });

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({
      id,
      name: "Robin",
      email: "robin@strawhatpirates.example.com",
      phone: "50599999999",
      createdAt,
    });
    expect(await db.select().from(tables.customer).where(eq(tables.customer.id, id))).toMatchObject([
      { merchantId, name: "Robin", email: "robin@strawhatpirates.example.com", phone: "50599999999", createdAt },
    ]);
    expect(
      await db.select().from(tables.customer).where(ne(tables.customer.id, id)).orderBy(tables.customer.id),
    ).toEqual(unrelatedBefore);
  });

  it("clears both contacts with explicit null without changing the name", async () => {
    const { db, service, merchantId } = await setup();
    const id = generateId({ model: "customer" });
    await db
      .insert(tables.customer)
      .values({ id, merchantId, name: "Nico Robin", email: "robin@strawhatpirates.example.com", phone: "50588888888" });

    const result = await service.execute([id, UpdateCustomerRequest.parse({ email: null, phone: null })]);

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({ id, name: "Nico Robin", email: null, phone: null });
    expect(await db.select().from(tables.customer)).toMatchObject([
      { id, merchantId, name: "Nico Robin", email: null, phone: null },
    ]);
  });

  it("returns an unchanged customer for an empty patch without changing timestamps", async () => {
    const { broadcast, db, service, merchantId } = await setup();
    const id = generateId({ model: "customer" });
    await db.insert(tables.customer).values({ id, merchantId, name: "Tony Tony Chopper" });
    const before = await db.select().from(tables.customer);

    const result = await service.execute([id, UpdateCustomerRequest.parse({})]);

    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "customer", snapshot: result.value },
    });

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({ id, name: "Tony Tony Chopper", updatedAt: before[0].updatedAt });
    expect(await db.select().from(tables.customer)).toEqual(before);
  });

  it.each(["missing", "foreign"])("rejects a %s customer without changing persistence", async (scenario) => {
    const { broadcast, db, service, merchantId, otherMerchantId } = await setup();
    const id = generateId({ model: "customer" });
    await db.insert(tables.customer).values({ id: generateId({ model: "customer" }), merchantId, name: "Nico Robin" });
    if (scenario === "foreign") {
      await db.insert(tables.customer).values({ id, merchantId: otherMerchantId, name: "Trafalgar Law" });
    }
    const before = await db.select().from(tables.customer).orderBy(tables.customer.id);

    const result = await service.execute([id, { name: "Bepo" }]);

    expect(broadcast).not.toHaveBeenCalled();

    expect(result).toEqual(
      err({ code: codes.resourceNotFound, message: `Customer ${id} has not been found.`, details: [] }),
    );
    expect(await db.select().from(tables.customer).orderBy(tables.customer.id)).toEqual(before);
  });
});
