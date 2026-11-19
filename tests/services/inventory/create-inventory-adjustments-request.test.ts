import { describe, expect, it } from "vitest";
import { CreateInventoryAdjustmentsRequest } from "../../../src/services/inventory/create-inventory-adjustments-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";

const locationId = generateId({ model: "location" });

function lineItem(overrides: Record<string, unknown> = {}) {
  return { variantId: generateId({ model: "variant" }), reason: "damaged", quantityDelta: -1, ...overrides };
}

describe("CreateInventoryAdjustmentsRequest", () => {
  it.each([-999_999_999, 999_999_999])("accepts a quantity delta of %i", (quantityDelta) => {
    const result = CreateInventoryAdjustmentsRequest.safeParse({
      locationId,
      lineItems: [lineItem({ quantityDelta })],
    });

    expect(result.success).toBe(true);
  });

  it.each([-1_000_000_000, 1_000_000_000, 0, 1.5])("rejects a quantity delta of %d", (quantityDelta) => {
    const result = CreateInventoryAdjustmentsRequest.safeParse({
      locationId,
      lineItems: [lineItem({ quantityDelta })],
    });

    expect(result.error?.issues).toEqual([expect.objectContaining({ path: ["lineItems", 0, "quantityDelta"] })]);
  });

  it("trims notes and accepts up to 256 characters", () => {
    const notes = "a".repeat(256);

    const request = CreateInventoryAdjustmentsRequest.parse({
      locationId,
      lineItems: [lineItem({ notes: `  ${notes}  ` })],
    });

    expect(request.lineItems[0].notes).toBe(notes);
  });

  it("rejects notes longer than 256 characters", () => {
    const result = CreateInventoryAdjustmentsRequest.safeParse({
      locationId,
      lineItems: [lineItem({ notes: "a".repeat(257) })],
    });

    expect(result.error?.issues).toEqual([expect.objectContaining({ path: ["lineItems", 0, "notes"] })]);
  });

  it("accepts up to 100 line items", () => {
    const lineItems = Array.from({ length: 100 }, () => lineItem());

    const result = CreateInventoryAdjustmentsRequest.safeParse({ locationId, lineItems });

    expect(result.success).toBe(true);
  });

  it.each([0, 101])("rejects %i line items", (count) => {
    const lineItems = Array.from({ length: count }, () => lineItem());

    const result = CreateInventoryAdjustmentsRequest.safeParse({ locationId, lineItems });

    expect(result.error?.issues).toEqual([expect.objectContaining({ path: ["lineItems"] })]);
  });

  it.each(["received", "sale", "initial_stock"])("rejects the %s reason", (reason) => {
    const result = CreateInventoryAdjustmentsRequest.safeParse({ locationId, lineItems: [lineItem({ reason })] });

    expect(result.error?.issues).toEqual([expect.objectContaining({ path: ["lineItems", 0, "reason"] })]);
  });
});
