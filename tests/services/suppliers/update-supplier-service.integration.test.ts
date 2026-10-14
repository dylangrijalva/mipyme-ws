import pino from "pino";
import { describe, expect, it } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import { tables } from "../../../src/db/schema.ts";
import { SupplierFinder } from "../../../src/finders/supplier-finder.ts";
import { UpdateSupplierService } from "../../../src/services/suppliers/update-supplier-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import { createRealtimeEventPublisherMock } from "../../test-utils/realtime-publisher-mock.ts";

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates" },
    { id: otherMerchantId, name: "Heart Pirates" },
  ]);
  const { broadcast, publisher } = createRealtimeEventPublisherMock();
  const service = UpdateSupplierService.create({
    publisher,
    db,
    logger: pino({ enabled: false }),
    supplierFinder: new SupplierFinder(),
    user: {
      id: "luffy",
      employeeId: "sanji",
      email: "sanji@strawhatpirates.example.com",
      accountType: "owner",
      merchantId,
    },
  });
  return { broadcast, db, merchantId, otherMerchantId, service };
}

describe("UpdateSupplierService", () => {
  it("updates supplied fields while preserving omitted contacts and unrelated suppliers", async () => {
    const { broadcast, db, merchantId, otherMerchantId, service } = await setup();
    const id = generateId({ model: "supplier" });
    const otherId = generateId({ model: "supplier" });
    const siblingId = generateId({ model: "supplier" });
    await db.insert(tables.supplier).values([
      { id, merchantId, name: "Sanji", email: "sanji@strawhatpirates.example.com", phone: "50512345678" },
      { id: otherId, merchantId: otherMerchantId, name: "Bepo" },
      { id: siblingId, merchantId, name: "Nami" },
    ]);
    const before = await db.select().from(tables.supplier);

    const result = await service.execute([id, { name: "Sanji's provisions", email: null }]);

    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "supplier", snapshot: result.value },
    });

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({ id, name: "Sanji's provisions", email: null, phone: "50512345678" });
    const after = await db.select().from(tables.supplier);
    expect(after.find((supplier) => supplier.id === id)).toMatchObject({
      merchantId,
      name: "Sanji's provisions",
      email: null,
      phone: "50512345678",
    });
    expect(after.filter((supplier) => supplier.id !== id)).toEqual(before.filter((supplier) => supplier.id !== id));
  });

  it("treats an empty patch as a no-op without changing timestamps", async () => {
    const { broadcast, db, merchantId, service } = await setup();
    const id = generateId({ model: "supplier" });
    await db.insert(tables.supplier).values({ id, merchantId, name: "Sanji", phone: "50512345678" });
    const [before] = await db.select().from(tables.supplier);

    const result = await service.execute([id, {}]);

    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "supplier", snapshot: result.value },
    });

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({
      id,
      name: before.name,
      phone: before.phone,
      createdAt: before.createdAt,
      updatedAt: before.updatedAt,
    });
    expect(await db.select().from(tables.supplier)).toEqual([before]);
  });

  it("returns not found for missing and foreign suppliers without changing records", async () => {
    const { db, otherMerchantId, service } = await setup();
    const foreignId = generateId({ model: "supplier" });
    await db.insert(tables.supplier).values({ id: foreignId, merchantId: otherMerchantId, name: "Bepo" });
    const before = await db.select().from(tables.supplier);

    for (const id of [foreignId, generateId({ model: "supplier" })]) {
      const result = await service.execute([id, { name: "Sanji" }]);
      expect(result).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    }
    expect(await db.select().from(tables.supplier)).toEqual(before);
  });
});
