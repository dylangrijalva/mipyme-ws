import { eq } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { tables } from "../../../src/db/schema.ts";
import { SupplierFinder } from "../../../src/finders/supplier-finder.ts";
import { CreateSupplierService } from "../../../src/services/suppliers/create-supplier-service.ts";
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
  const service = CreateSupplierService.create({
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

describe("CreateSupplierService", () => {
  it.each([{ name: "Sanji" }, { name: "Sanji", email: "sanji@strawhatpirates.example.com", phone: "50512345678" }])(
    "persists supplier contacts and current merchant ownership: %j",
    async (request) => {
      const { db, merchantId, service } = await setup();

      const result = await service.execute(request);

      expect(result.success).toBe(true);
      const [stored] = await db.select().from(tables.supplier);
      expect(stored).toMatchObject({
        id: result.value?.id,
        merchantId,
        name: request.name,
        email: request.email ?? null,
        phone: request.phone ?? null,
      });
      expect(result.value).toMatchObject({
        id: stored.id,
        name: stored.name,
        email: stored.email,
        phone: stored.phone,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
      });
      expect(result.value).not.toHaveProperty("merchantId");
    },
  );

  it("allows duplicate supplier names and contacts without replacing the existing supplier", async () => {
    const { db, merchantId, service } = await setup();
    const id = generateId({ model: "supplier" });
    const request = { name: "Sanji", email: "sanji@strawhatpirates.example.com", phone: "50512345678" };
    await db.insert(tables.supplier).values({ id, merchantId, ...request });
    const [before] = await db.select().from(tables.supplier).where(eq(tables.supplier.id, id));

    const result = await service.execute(request);

    expect(result.success).toBe(true);
    expect(result.value?.id).not.toBe(id);
    expect(await db.select().from(tables.supplier)).toHaveLength(2);
    expect(await db.select().from(tables.supplier).where(eq(tables.supplier.id, id))).toEqual([before]);
  });
});
