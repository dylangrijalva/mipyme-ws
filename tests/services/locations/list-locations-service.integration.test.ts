import { describe, expect, it } from "vitest";
import { tables } from "../../../src/db/schema.ts";
import { ListLocationsService } from "../../../src/services/locations/list-locations-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { ok } from "../../../src/utils/result.ts";
import { setupLocations } from "../../test-utils/location-fixture.ts";

describe("ListLocationsService", () => {
  it.each(["owner", "staff"] as const)(
    "paginates visible locations for an %s before computing continuation metadata",
    async (accountType) => {
      const { dependencies, db, merchantId, otherMerchantId, employeeId } = await setupLocations(accountType);
      const firstId = "loc_00000000000000000001";
      const hiddenId = "loc_00000000000000000002";
      const foreignId = "loc_00000000000000000003";
      const lastId = "loc_00000000000000000004";
      await db.insert(tables.location).values([
        { id: lastId, merchantId, name: "Loguetown" },
        { id: hiddenId, merchantId, name: "Dressrosa" },
        { id: foreignId, merchantId: otherMerchantId, name: "Sabaody" },
        { id: firstId, merchantId, name: "Water 7" },
      ]);
      await db.insert(tables.locationAccess).values(
        [firstId, lastId].map((locationId) => ({
          id: generateId({ model: "locationAccess" }),
          merchantId,
          employeeId,
          locationId,
        })),
      );
      const service = ListLocationsService.create(dependencies);

      const first = await service.execute({ limit: 1 });
      const remainder = await service.execute({ limit: 2, cursor: first.value!.nextCursor! });
      const empty = await service.execute({ limit: 1, cursor: lastId });

      expect(first.value).toMatchObject({
        results: [{ id: firstId, name: "Water 7" }],
        hasMore: true,
        nextCursor: firstId,
      });
      expect(first.value!.results).toHaveLength(1);
      expect(remainder.value!.results.map((location) => location.id)).toEqual(
        accountType === "owner" ? [hiddenId, lastId] : [lastId],
      );
      expect(remainder.value).toMatchObject({ hasMore: false, nextCursor: null });
      expect(empty).toEqual(ok({ results: [], nextCursor: null, hasMore: false }));
      expect(first.value!.results[0]).not.toHaveProperty("merchantId");
    },
  );

  it("returns an empty terminal page when the employee has no assigned locations", async () => {
    const { dependencies, db, merchantId, otherMerchantId } = await setupLocations("staff");
    await db.insert(tables.location).values([
      { id: generateId({ model: "location" }), merchantId, name: "Water 7" },
      { id: generateId({ model: "location" }), merchantId: otherMerchantId, name: "Sabaody" },
    ]);

    const result = await ListLocationsService.create(dependencies).execute({ limit: 50 });

    expect(result).toEqual(ok({ results: [], nextCursor: null, hasMore: false }));
  });
});
