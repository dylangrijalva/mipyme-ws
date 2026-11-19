import { describe, expect, it } from "vitest";
import { InventoryLevel } from "../../src/contracts/inventory-level.ts";

const RESTOCKED_AT = new Date("2026-10-15T18:00:00.000Z");
const ADJUSTED_AT = new Date("2026-10-16T18:00:00.000Z");

const buildInventoryLevel = ({
  onHand,
  lowStockThreshold,
  lastRestockAt = RESTOCKED_AT,
}: {
  onHand: number;
  lowStockThreshold: number;
  lastRestockAt?: Date | null;
}) => ({
  id: "inv_ZORO0000000000000001",
  variantId: "var_ZORO0000000000000001",
  locationId: "loc_ZORO0000000000000001",
  onHand,
  lowStockThreshold,
  optimalStockLevel: 24,
  lastSoldAt: null,
  lastRestockAt,
  lastInventoryAdjustmentAt: ADJUSTED_AT,
});

describe("InventoryLevel", () => {
  it.each([
    { onHand: 0, lowStockThreshold: 0, stockStatus: "out_of_stock" },
    { onHand: 0, lowStockThreshold: 5, stockStatus: "out_of_stock" },
    { onHand: 1, lowStockThreshold: 5, stockStatus: "low_stock" },
    { onHand: 5, lowStockThreshold: 5, stockStatus: "low_stock" },
    { onHand: 6, lowStockThreshold: 5, stockStatus: "in_stock" },
    { onHand: 10, lowStockThreshold: 0, stockStatus: "in_stock" },
  ])(
    "computes $stockStatus for a restocked level when on hand is $onHand and the low stock threshold is $lowStockThreshold",
    ({ onHand, lowStockThreshold, stockStatus }) => {
      const inventoryLevel = InventoryLevel.parse(buildInventoryLevel({ onHand, lowStockThreshold }));

      expect(inventoryLevel.stockStatus).toBe(stockStatus);
    },
  );

  it.each([
    { onHand: 0, lowStockThreshold: 0, stockStatus: "not_stocked" },
    { onHand: 0, lowStockThreshold: 5, stockStatus: "not_stocked" },
    { onHand: 3, lowStockThreshold: 5, stockStatus: "low_stock" },
    { onHand: 6, lowStockThreshold: 5, stockStatus: "in_stock" },
  ])(
    "computes $stockStatus for a never restocked level when on hand is $onHand and the low stock threshold is $lowStockThreshold",
    ({ onHand, lowStockThreshold, stockStatus }) => {
      const inventoryLevel = InventoryLevel.parse(
        buildInventoryLevel({ onHand, lowStockThreshold, lastRestockAt: null }),
      );

      expect(inventoryLevel.stockStatus).toBe(stockStatus);
    },
  );

  it("keeps the stored inventory fields unchanged when computing the stock status", () => {
    const input = buildInventoryLevel({ onHand: 3, lowStockThreshold: 5 });

    const inventoryLevel = InventoryLevel.parse(input);

    expect(inventoryLevel).toEqual({ ...input, stockStatus: "low_stock" });
  });
});
