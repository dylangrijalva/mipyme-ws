import { eq } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { tables } from "../../../src/db/schema.ts";
import { CustomerFinder } from "../../../src/finders/customer-finder.ts";
import {
  CreateCustomerRequest,
  CreateCustomerService,
} from "../../../src/services/customers/create-customer-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { ok } from "../../../src/utils/result.ts";
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
  const service = CreateCustomerService.create({
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

describe("CreateCustomerService", () => {
  it("persists trimmed contact information for the current merchant and returns the public customer", async () => {
    const { broadcast, db, service, merchantId, otherMerchantId } = await setup();
    const otherId = generateId({ model: "customer" });
    await db.insert(tables.customer).values({ id: otherId, merchantId: otherMerchantId, name: "Trafalgar Law" });
    const [otherBefore] = await db.select().from(tables.customer).where(eq(tables.customer.id, otherId));
    const request = CreateCustomerRequest.parse({
      name: "  Nico Robin  ",
      email: "  robin@strawhatpirates.example.com  ",
      phone: "  50588888888  ",
    });

    const result = await service.execute(request);

    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "customer", snapshot: result.value },
    });

    expect(result).toEqual(
      ok({
        id: expect.any(String),
        name: "Nico Robin",
        email: "robin@strawhatpirates.example.com",
        phone: "50588888888",
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
    const [stored] = await db.select().from(tables.customer).where(eq(tables.customer.id, result.value!.id));
    expect(stored).toMatchObject({
      id: result.value!.id,
      merchantId,
      name: "Nico Robin",
      email: "robin@strawhatpirates.example.com",
      phone: "50588888888",
    });
    expect(await db.select().from(tables.customer).where(eq(tables.customer.id, otherId))).toEqual([otherBefore]);
  });

  it.each([
    { scenario: "omitted", contacts: {} },
    { scenario: "explicitly null", contacts: { email: null, phone: null } },
  ])("persists $scenario contacts as null", async ({ contacts }) => {
    const { db, service, merchantId } = await setup();
    const request = CreateCustomerRequest.parse({ name: "Tony Tony Chopper", ...contacts });

    const result = await service.execute(request);

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({ name: "Tony Tony Chopper", email: null, phone: null });
    expect(await db.select().from(tables.customer)).toMatchObject([
      { id: result.value!.id, merchantId, email: null, phone: null },
    ]);
  });
});
