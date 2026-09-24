import { describe, expect, it, vi } from "vitest";
import { generateId } from "../../src/utils/generate-id.ts";
import { ID_PREFIXES, ObjectId } from "../../src/contracts/object-id.ts";

vi.mock("nanoid", async (importOriginal) => {
  const original = await importOriginal<typeof import("nanoid")>();
  return {
    ...original,
    customAlphabet: (alphabet: string, size: number) =>
      original.customRandom(alphabet, size, (length) => new Uint8Array(length)),
  };
});

describe("generateId", () => {
  it.each([undefined, {}, { length: undefined }])("uses the default length without a model: %j", (params) => {
    const result = generateId(params);

    expect(result).toBe("0".repeat(24));
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

  it.each([1, 12, 30])("supports an unprefixed length of %i", (length) => {
    const result = generateId({ length });

    expect(result).toBe("0".repeat(length));
  });

  it("includes the prefix and separator in a custom total length", () => {
    const result = generateId({ model: "product", length: 10 });

    expect(result).toBe("prod_00000");
  });

  it("allows exactly one random character after a prefix containing an underscore", () => {
    const result = generateId({ model: "productOptionGroup", length: 10 });

    expect(result).toBe("prod_opt_0");
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
