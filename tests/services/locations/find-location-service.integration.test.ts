import { describe, expect, it } from "vitest";
import { tables } from "../../../src/db/schema.ts";
import { FindLocationService } from "../../../src/services/locations/find-location-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { setupLocations } from "../../test-utils/location-fixture.ts";

describe("FindLocationService", () => {
  it.each(["owner", "staff"] as const)(
    "returns a visible location for an %s without exposing merchant ownership",
    async (accountType) => {
      const { dependencies, db, merchantId, employeeId } = await setupLocations(accountType);
      const id = generateId({ model: "location" });
      await db.insert(tables.location).values({ id, merchantId, name: "Water 7", businessType: "grocery_store" });
      if (accountType === "staff") {
        await db
          .insert(tables.locationAccess)
          .values({ id: generateId({ model: "locationAccess" }), merchantId, employeeId, locationId: id });
      }

      const result = await FindLocationService.create(dependencies).execute(id);

      expect(result.success).toBe(true);
      expect(result.value).toEqual({
        id,
        name: "Water 7",
        businessType: "grocery_store",
        phone: null,
        address: null,
        taxId: null,
        taxRate: "0.00",
        exchangeRate: "0.00",
        nextSaleNumber: 1,
        nextPurchaseOrderNumber: 1,
        allowBackorders: false,
        receiptHeaderText: null,
        receiptFooterText: null,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    },
  );

  it.each(["missing", "foreign", "unassigned", "assigned to another employee"])(
    "hides a location that is %s",
    async (scenario) => {
      const { dependencies, db, merchantId, otherMerchantId } = await setupLocations(
        scenario === "foreign" ? "owner" : "staff",
      );
      const id = generateId({ model: "location" });
      if (scenario !== "missing") {
        await db
          .insert(tables.location)
          .values({ id, merchantId: scenario === "foreign" ? otherMerchantId : merchantId, name: "Sabaody" });
      }
      if (scenario === "assigned to another employee") {
        const employeeId = generateId({ model: "employee" });
        await db.insert(tables.employee).values({ id: employeeId, merchantId, name: "Sanji", status: "enabled" });
        await db
          .insert(tables.locationAccess)
          .values({ id: generateId({ model: "locationAccess" }), merchantId, employeeId, locationId: id });
      }

      const result = await FindLocationService.create(dependencies).execute(id);

      expect(result).toMatchObject({ success: false, error: { code: "resource_not_found" } });
    },
  );
});
