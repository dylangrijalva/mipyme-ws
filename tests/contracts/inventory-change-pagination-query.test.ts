import { describe, expect, it } from "vitest";
import { InventoryChangePaginationRequest } from "../../src/contracts/inventory-change-pagination-query.ts";
import { generateId } from "../../src/utils/generate-id.ts";

describe("InventoryChangePaginationRequest", () => {
  it("splits comma-separated filters and drops repeated values", () => {
    const [crate, basket] = [generateId({ model: "variant" }), generateId({ model: "variant" })];

    const request = InventoryChangePaginationRequest.parse({
      variantIds: `${crate},${basket},${crate}`,
      reasons: "damaged,theft",
    });

    expect(request).toEqual({ limit: 50, variantIds: [crate, basket], reasons: ["damaged", "theft"] });
  });

  it("converts the occurred date range to inclusive database timestamps", () => {
    const request = InventoryChangePaginationRequest.parse({
      from: "2026-11-19T10:00:00.0000005-06:00",
      to: "2026-11-19T10:30:00.0000005-06:00",
    });

    expect(request).toMatchObject({ from: "2026-11-19 16:00:00.000001", to: "2026-11-19 16:30:00.000000" });
  });

  it.each([
    { scenario: "an unknown reason", query: { reasons: "damaged,sunk" }, path: ["reasons", 1] },
    { scenario: "an empty list", query: { locationIds: "" }, path: ["locationIds"] },
    { scenario: "a malformed id", query: { createdByIds: "Nami" }, path: ["createdByIds", 0] },
    {
      scenario: "more than 100 values",
      query: { variantIds: Array.from({ length: 101 }, () => generateId({ model: "variant" })).join(",") },
      path: ["variantIds"],
    },
    {
      scenario: "a range that ends before it starts",
      query: { from: "2026-11-19T12:00:00Z", to: "2026-11-19T11:59:59Z" },
      path: ["to"],
    },
    { scenario: "a malformed cursor", query: { cursor: "not a cursor" }, path: ["cursor"] },
  ])("rejects $scenario", ({ query, path }) => {
    const result = InventoryChangePaginationRequest.safeParse(query);

    expect(result.success).toBe(false);
    expect(result.error?.issues.length).toBeGreaterThan(0);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual(result.error?.issues.map(() => path));
  });
});
