import { describe, expect, it } from "vitest";
import { generateId } from "../../src/utils/generate-id.ts";
import { ID_PREFIXES, ObjectId } from "../../src/contracts/object-id.ts";

describe("generateId", () => {
  it("generates an unprefixed ID by default", () => {
    const result = generateId();

    expect(result).toMatch(/^[0-9A-Z]{24}$/);
    expect(ObjectId.safeParse(result).success).toBe(true);
  });

  it.each(Object.keys(ID_PREFIXES) as Array<keyof typeof ID_PREFIXES>)(
    "generates a schema-valid ID for %s",
    (model) => {
      const result = generateId({ model });

      expect(result).toHaveLength(24);
      expect(result.startsWith(`${ID_PREFIXES[model]}_`)).toBe(true);
      expect(ObjectId.safeParse(result).success).toBe(true);
    },
  );

  it("supports a custom unprefixed length", () => {
    const result = generateId({ length: 12 });

    expect(result).toMatch(/^[0-9A-Z]{12}$/);
  });

  it("includes the prefix and separator in a custom total length", () => {
    const result = generateId({ model: "product", length: 10 });

    expect(result).toMatch(/^prod_[0-9A-Z]{5}$/);
  });

  it("allows exactly one random character after a prefix containing an underscore", () => {
    const result = generateId({ model: "productOptionGroup", length: 10 });

    expect(result).toMatch(/^prod_opt_[0-9A-Z]$/);
  });

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid total length %s",
    (length) => {
      expect(() => generateId({ length })).toThrow(RangeError);
    },
  );

  it.each([1, 4, 5])("rejects length %i when the prefix leaves no random characters", (length) => {
    expect(() => generateId({ model: "product", length })).toThrow(RangeError);
  });
});
