import { describe, expect, it } from "vitest";
import { InventoryLevel } from "../../src/contracts/inventory-level.ts";

const buildInventoryLevel = ({ onHand, lowStockThreshold }: { onHand: number; lowStockThreshold: number }) => ({
  id: "inv_ZORO0000000000000001",
  variantId: "var_ZORO0000000000000001",
  locationId: "loc_ZORO0000000000000001",
  onHand,
  lowStockThreshold,
  optimalStockLevel: 24,
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
    "computes $stockStatus when on hand is $onHand and the low stock threshold is $lowStockThreshold",
    ({ onHand, lowStockThreshold, stockStatus }) => {
      const inventoryLevel = InventoryLevel.parse(buildInventoryLevel({ onHand, lowStockThreshold }));

      expect(inventoryLevel.stockStatus).toBe(stockStatus);
    },
  );

  it("keeps the stored inventory fields unchanged when computing the stock status", () => {
    const input = buildInventoryLevel({ onHand: 3, lowStockThreshold: 5 });

    const inventoryLevel = InventoryLevel.parse(input);

    expect(inventoryLevel).toEqual({ ...input, stockStatus: "low_stock" });
  });
});
