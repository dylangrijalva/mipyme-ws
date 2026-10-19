import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { tables } from "../../../src/db/schema.ts";
import {
  CreateLocationRequest,
  CreateLocationService,
} from "../../../src/services/locations/create-location-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { setupLocations } from "../../test-utils/location-fixture.ts";

describe("CreateLocationService", () => {
  it("persists all configurable fields for the current merchant and publishes the public snapshot", async () => {
    const { dependencies, db, merchantId, otherMerchantId, broadcast } = await setupLocations();
    const foreignId = generateId({ model: "location" });
    await db.insert(tables.location).values({ id: foreignId, merchantId: otherMerchantId, name: "Sabaody" });
    const [foreignBefore] = await db.select().from(tables.location).where(eq(tables.location.id, foreignId));
    const request = CreateLocationRequest.parse({
      name: "  Water 7  ",
      businessType: "grocery_store",
      phone: "  50588888888  ",
      address: "  Dock 1  ",
      taxId: "  STRAWHAT  ",
      taxRate: "15",
      exchangeRate: "36.5",
      allowBackorders: true,
      receiptHeaderText: "  Straw Hat Pirates  ",
      receiptFooterText: "  Thank you  ",
      merchantId: otherMerchantId,
      nextSaleNumber: 99,
      nextPurchaseOrderNumber: 99,
    });

    const result = await CreateLocationService.create(dependencies).execute(request);

    expect(result.success).toBe(true);
    expect(result.value).toEqual({
      id: expect.any(String),
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
      nextSaleNumber: 1,
      nextPurchaseOrderNumber: 1,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(await db.select().from(tables.location).where(eq(tables.location.id, result.value!.id))).toMatchObject([
      { ...result.value, merchantId },
    ]);
    expect(await db.select().from(tables.location).where(eq(tables.location.id, foreignId))).toEqual([foreignBefore]);
    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "location", snapshot: result.value },
    });
  });

  it.each([undefined, null])("uses creation defaults and preserves an explicit null tax rate (%s)", async (taxRate) => {
    const { dependencies, db } = await setupLocations();

    const result = await CreateLocationService.create(dependencies).execute({
      name: "Foosha Village",
      businessType: "other",
      taxRate,
    });

    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({
      name: "Foosha Village",
      businessType: "other",
      phone: null,
      address: null,
      taxId: null,
      taxRate: taxRate === null ? null : "0.00",
      exchangeRate: "0.00",
      allowBackorders: false,
      receiptHeaderText: null,
      receiptFooterText: null,
      nextSaleNumber: 1,
      nextPurchaseOrderNumber: 1,
    });
    expect(await db.select().from(tables.location)).toMatchObject([
      { ...result.value, merchantId: dependencies.user.merchantId },
    ]);
  });

  it("allows the third location despite other merchants' locations, then rejects a fourth without side effects", async () => {
    const { dependencies, db, merchantId, otherMerchantId, broadcast } = await setupLocations();
    await db.insert(tables.location).values([
      { id: generateId({ model: "location" }), merchantId, name: "Water 7" },
      { id: generateId({ model: "location" }), merchantId, name: "Foosha Village" },
      { id: generateId({ model: "location" }), merchantId: otherMerchantId, name: "Sabaody" },
    ]);
    const service = CreateLocationService.create(dependencies);

    const third = await service.execute({ name: "Loguetown", businessType: "other" });
    const before = await db.select().from(tables.location).orderBy(tables.location.id);
    const fourth = await service.execute({ name: "Dressrosa", businessType: "other" });

    expect(third.success).toBe(true);
    expect(fourth).toMatchObject({ success: false, error: { code: "location_limit_exceeded" } });
    expect(await db.select().from(tables.location).orderBy(tables.location.id)).toEqual(before);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("admits only one simultaneous create when the merchant has one slot remaining", async () => {
    const { dependencies, db, merchantId, broadcast } = await setupLocations();
    await db
      .insert(tables.location)
      .values(
        ["Water 7", "Foosha Village"].map((name) => ({ id: generateId({ model: "location" }), merchantId, name })),
      );
    const service = CreateLocationService.create(dependencies);

    const results = await Promise.all(
      ["Loguetown", "Dressrosa"].map((name) => service.execute({ name, businessType: "other" })),
    );

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.find((result) => !result.success)?.error?.code).toBe("location_limit_exceeded");
    const stored = await db.select().from(tables.location).where(eq(tables.location.merchantId, merchantId));
    expect(stored).toHaveLength(3);
    expect(stored.some((location) => location.id === results.find((result) => result.success)?.value?.id)).toBe(true);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("rejects staff creation without storing a location or publishing an event", async () => {
    const { dependencies, db, broadcast } = await setupLocations("staff");

    const result = await CreateLocationService.create(dependencies).execute({ name: "Water 7", businessType: "other" });

    expect(result).toMatchObject({ success: false, error: { code: "forbidden_error" } });
    expect(await db.select().from(tables.location)).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
