import { describe, expect, it } from "vitest";
import { hasDefinedValues } from "../../src/utils/has-defined-values.ts";

describe("hasDefinedValues", () => {
  it.each([
    { scenario: "an empty object", object: {}, expected: false },
    { scenario: "only undefined properties", object: { name: undefined, price: undefined }, expected: false },
    { scenario: "a null property", object: { collectionId: null }, expected: true },
    { scenario: "a false property", object: { enabled: false }, expected: true },
    { scenario: "a zero property", object: { quantity: 0 }, expected: true },
    { scenario: "an empty string property", object: { name: "" }, expected: true },
  ])("returns $expected for $scenario", ({ object, expected }) => {
    expect(hasDefinedValues(object)).toBe(expected);
  });
});
