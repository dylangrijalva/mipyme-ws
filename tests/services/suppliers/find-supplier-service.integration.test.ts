import pino from "pino";
import { describe, expect, it } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import { tables } from "../../../src/db/schema.ts";
import { SupplierFinder } from "../../../src/finders/supplier-finder.ts";
import { FindSupplierService } from "../../../src/services/suppliers/find-supplier-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates" },
    { id: otherMerchantId, name: "Heart Pirates" },
  ]);
  const service = FindSupplierService.create({
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
  return { db, merchantId, otherMerchantId, service };
}

describe("FindSupplierService", () => {
  it("returns the current merchant's stored supplier and contacts", async () => {
    const { db, merchantId, service } = await setup();
    const id = generateId({ model: "supplier" });
    await db
      .insert(tables.supplier)
      .values({ id, merchantId, name: "Sanji", email: "sanji@strawhatpirates.example.com", phone: "50512345678" });
    const [stored] = await db.select().from(tables.supplier);

    const result = await service.execute(id);

    expect(result.success).toBe(true);
    expect(result.value).toEqual({
      id,
      name: stored.name,
      email: stored.email,
      phone: stored.phone,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    });
  });

  it("returns not found for missing and foreign suppliers", async () => {
    const { db, otherMerchantId, service } = await setup();
    const foreignId = generateId({ model: "supplier" });
    await db.insert(tables.supplier).values({ id: foreignId, merchantId: otherMerchantId, name: "Bepo" });

    for (const id of [foreignId, generateId({ model: "supplier" })]) {
      const result = await service.execute(id);
      expect(result).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    }
  });
});
