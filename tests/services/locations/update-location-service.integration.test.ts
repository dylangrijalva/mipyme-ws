import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { tables } from "../../../src/db/schema.ts";
import {
  UpdateLocationRequest,
  UpdateLocationService,
} from "../../../src/services/locations/update-location-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { setupLocations } from "../../test-utils/location-fixture.ts";

describe("UpdateLocationService", () => {
  it("updates configurable fields while preserving counters, ownership, and unrelated locations", async () => {
    const { dependencies, db, merchantId, otherMerchantId, broadcast } = await setupLocations();
    const id = generateId({ model: "location" });
    const otherId = generateId({ model: "location" });
    const createdAt = new Date("2026-01-01T00:00:00Z");
    await db.insert(tables.location).values([
      {
        id,
        merchantId,
        name: "Water 7",
        phone: "50588888888",
        businessType: "other",
        nextSaleNumber: 42,
        nextPurchaseOrderNumber: 24,
        createdAt,
        updatedAt: createdAt,
      },
      { id: otherId, merchantId: otherMerchantId, name: "Sabaody" },
    ]);
    const [otherBefore] = await db.select().from(tables.location).where(eq(tables.location.id, otherId));
    const request = UpdateLocationRequest.parse({
      name: "  Dock 1  ",
      businessType: "grocery_store",
      address: "  Water 7  ",
      taxId: "  STRAWHAT  ",
      taxRate: "15",
      exchangeRate: "36.5",
      allowBackorders: true,
      receiptHeaderText: "  Straw Hat Pirates  ",
      receiptFooterText: "  Thank you  ",
      nextSaleNumber: 99,
      nextPurchaseOrderNumber: 99,
      merchantId: otherMerchantId,
      createdAt: new Date(),
    });

    const result = await UpdateLocationService.create(dependencies).execute([id, request]);

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({
      id,
      name: "Dock 1",
      businessType: "grocery_store",
      phone: "50588888888",
      address: "Water 7",
      taxId: "STRAWHAT",
      taxRate: "15.00",
      exchangeRate: "36.50",
      allowBackorders: true,
      receiptHeaderText: "Straw Hat Pirates",
      receiptFooterText: "Thank you",
      nextSaleNumber: 42,
      nextPurchaseOrderNumber: 24,
      createdAt,
    });
    expect(result.value!.updatedAt.getTime()).toBeGreaterThan(createdAt.getTime());
    expect(await db.select().from(tables.location).where(eq(tables.location.id, id))).toMatchObject([
      { ...result.value, merchantId },
    ]);
    expect(await db.select().from(tables.location).where(eq(tables.location.id, otherId))).toEqual([otherBefore]);
    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "location", snapshot: result.value },
    });
  });

  it("clears nullable fields and accepts false and zero while preserving the name and business type", async () => {
    const { dependencies, db, merchantId } = await setupLocations();
    const id = generateId({ model: "location" });
    await db.insert(tables.location).values({
      id,
      merchantId,
      name: "Water 7",
      businessType: "grocery_store",
      phone: "50588888888",
      address: "Dock 1",
      taxId: "STRAWHAT",
      taxRate: "15.00",
      exchangeRate: "36.50",
      allowBackorders: true,
      receiptHeaderText: "Straw Hat Pirates",
      receiptFooterText: "Thank you",
    });

    const result = await UpdateLocationService.create(dependencies).execute([
      id,
      {
        phone: null,
        address: null,
        taxId: null,
        taxRate: null,
        receiptHeaderText: null,
        receiptFooterText: null,
        allowBackorders: false,
        exchangeRate: "0",
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({
      name: "Water 7",
      businessType: "grocery_store",
      phone: null,
      address: null,
      taxId: null,
      taxRate: null,
      receiptHeaderText: null,
      receiptFooterText: null,
      allowBackorders: false,
      exchangeRate: "0.00",
    });
    expect(await db.select().from(tables.location)).toMatchObject([{ ...result.value, merchantId }]);
  });

  it("leaves all values and timestamps unchanged for an empty patch", async () => {
    const { dependencies, db, merchantId } = await setupLocations();
    const id = generateId({ model: "location" });
    await db.insert(tables.location).values({ id, merchantId, name: "Water 7" });
    const before = await db.select().from(tables.location);

    const result = await UpdateLocationService.create(dependencies).execute([id, {}]);

    expect(result.success).toBe(true);
    expect(result.value!.updatedAt).toEqual(before[0].updatedAt);
    expect(await db.select().from(tables.location)).toEqual(before);
  });

  it.each(["missing", "foreign", "staff"] as const)(
    "rejects a %s update without changing records or publishing",
    async (scenario) => {
      const { dependencies, db, merchantId, otherMerchantId, broadcast } = await setupLocations(
        scenario === "staff" ? "staff" : "owner",
      );
      const id = generateId({ model: "location" });
      await db.insert(tables.location).values({
        id: scenario === "missing" ? generateId({ model: "location" }) : id,
        merchantId: scenario === "foreign" ? otherMerchantId : merchantId,
        name: "Water 7",
      });
      const before = await db.select().from(tables.location);

      const result = await UpdateLocationService.create(dependencies).execute([id, { name: "Dressrosa" }]);

      expect(result).toMatchObject({
        success: false,
        error: { code: scenario === "staff" ? "forbidden_error" : "resource_not_found" },
      });
      expect(await db.select().from(tables.location)).toEqual(before);
      expect(broadcast).not.toHaveBeenCalled();
    },
  );
});
