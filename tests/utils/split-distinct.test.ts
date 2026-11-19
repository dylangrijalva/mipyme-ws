import { describe, expect, it } from "vitest";
import { splitDistinct } from "../../src/utils/split-distinct.ts";

describe("splitDistinct", () => {
  it.each([null, undefined, ""])("returns an empty array for %s", (input) => {
    const result = splitDistinct(input, " ");

    expect(result).toStrictEqual([]);
  });

  it("deduplicates space-separated permissions while preserving first-occurrence order", () => {
    const input = "  sales:write  inventory:read sales:write sales:read inventory:read  ";

    const result = splitDistinct(input, " ");

    expect(result).toStrictEqual(["sales:write", "inventory:read", "sales:read"]);
  });

  it("returns an empty array when the input contains only delimiters", () => {
    const result = splitDistinct("   ", " ");

    expect(result).toStrictEqual([]);
  });
});
