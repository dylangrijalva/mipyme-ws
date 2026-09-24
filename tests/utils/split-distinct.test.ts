import { describe, expect, it } from "vitest";
import { splitDistinct } from "../../src/utils/split-distinct.ts";

describe("splitDistinct", () => {
  it.each([null, undefined, ""])("returns an empty array for %s", (input) => {
    const result = splitDistinct(input, " ");

    expect(result).toStrictEqual([]);
  });

  it("deduplicates space-separated permissions while preserving first-occurrence order", () => {
    const input = "sales:write inventory:read sales:write sales:read inventory:read";

    const result = splitDistinct(input, " ");

    expect(result).toStrictEqual(["sales:write", "inventory:read", "sales:read"]);
  });

  it("deduplicates space-separated scopes", () => {
    const input = "openid profile email profile openid";

    const result = splitDistinct(input, " ");

    expect(result).toStrictEqual(["openid", "profile", "email"]);
  });

  it("ignores leading, repeated, and trailing spaces between permissions", () => {
    const input = "  sales:read   sales:write  ";

    const result = splitDistinct(input, " ");

    expect(result).toStrictEqual(["sales:read", "sales:write"]);
  });

  it("returns an empty array when the input contains only delimiters", () => {
    const result = splitDistinct("   ", " ");

    expect(result).toStrictEqual([]);
  });

  it("preserves the whole value when the delimiter is absent", () => {
    const result = splitDistinct("inventory:read", " ");

    expect(result).toStrictEqual(["inventory:read"]);
  });

  it("preserves whitespace and case when comparing segments", () => {
    const input = "sales:read, sales:read,sales:read ,Sales:Read, ,sales:read";

    const result = splitDistinct(input, ",");

    expect(result).toStrictEqual(["sales:read", " sales:read", "sales:read ", "Sales:Read", " "]);
  });

  it("treats a multi-character delimiter containing regex characters literally", () => {
    const input = "sales:read.*inventory:read.*sales:read.*sales:write";

    const result = splitDistinct(input, ".*");

    expect(result).toStrictEqual(["sales:read", "inventory:read", "sales:write"]);
  });

  it("returns distinct characters when the delimiter is empty", () => {
    const result = splitDistinct("access", "");

    expect(result).toStrictEqual(["a", "c", "e", "s"]);
  });
});
