import pino from "pino";
import { describe, expect, it } from "vitest";
import { tables } from "../../../src/db/schema.ts";
import { SupplierFinder } from "../../../src/finders/supplier-finder.ts";
import { ListSuppliersService } from "../../../src/services/suppliers/list-suppliers-service.ts";
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
  const service = ListSuppliersService.create({
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

describe("ListSuppliersService", () => {
  it("paginates only the current merchant in ID order and terminates after the last page", async () => {
    const { db, merchantId, otherMerchantId, service } = await setup();
    const ids = ["supp_0000000000000000001", "supp_0000000000000000003", "supp_0000000000000000005"];
    await db
      .insert(tables.supplier)
      .values([
        ...ids.toReversed().map((id) => ({ id, merchantId, name: "Sanji" })),
        { id: "supp_0000000000000000002", merchantId: otherMerchantId, name: "Bepo" },
      ]);

    const first = await service.execute({ limit: 2 });

    expect(first.success).toBe(true);
    expect(first.value?.results.map((supplier) => supplier.id)).toEqual(ids.slice(0, 2));
    expect(first.value).toMatchObject({
      hasMore: true,
      nextCursor: ids[1],
      results: [
        { name: "Sanji", email: null, phone: null },
        { name: "Sanji", email: null, phone: null },
      ],
    });
    const last = await service.execute({ limit: 2, cursor: ids[1] });
    expect(last.value?.results.map((supplier) => supplier.id)).toEqual([ids[2]]);
    expect(last.value).toMatchObject({ hasMore: false, nextCursor: null });
    expect((await service.execute({ limit: 2, cursor: ids[2] })).value).toEqual({
      results: [],
      hasMore: false,
      nextCursor: null,
    });
  });
});
