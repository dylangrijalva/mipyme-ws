import { describe, expect, it } from "vitest";
import { camelCaseKeys } from "../../src/utils/camel-case-keys.ts";

describe("camelCaseKeys", () => {
  it("converts keys in nested objects and arrays", () => {
    const input = { crew_name: "Straw Hat Pirates", crew_members: [{ full_name: "Nico Robin" }] };

    const result = camelCaseKeys(input);

    expect(result).toStrictEqual({ crewName: "Straw Hat Pirates", crewMembers: [{ fullName: "Nico Robin" }] });
  });

  it("handles top-level and nested arrays with mixed values", () => {
    const result = camelCaseKeys([{ full_name: "Nami" }, [{ home_town: "Cocoyasi Village" }], null, 0, false]);

    expect(result).toStrictEqual([{ fullName: "Nami" }, [{ homeTown: "Cocoyasi Village" }], null, 0, false]);
  });

  it("normalizes separated keys, PascalCase, and acronyms", () => {
    const result = camelCaseKeys({
      "crew-name": "Straw Hat Pirates",
      "home town": "Foosha Village",
      FullName: "Luffy",
      crewID: 1,
    });

    expect(result).toStrictEqual({
      crewName: "Straw Hat Pirates",
      homeTown: "Foosha Village",
      fullName: "Luffy",
      crewId: 1,
    });
  });

  it("preserves emoji-only keys, including joined emoji and sequences", () => {
    const input = { "🏴‍☠️": { ship_name: "Thousand Sunny" }, "🍊⚓": "Nami", "": "Water 7" };

    const result = camelCaseKeys(input);

    expect(result).toStrictEqual({ "🏴‍☠️": { shipName: "Thousand Sunny" }, "🍊⚓": "Nami", "": "Water 7" });
  });

  it.each([null, undefined, "", "Nami", 0, false, 10n, Symbol("luffy")])("preserves primitive %s", (input) => {
    const result = camelCaseKeys(input);

    expect(result).toBe(input);
  });

  it("preserves null, undefined, and falsy property values", () => {
    const result = camelCaseKeys({
      home_town: null,
      crew_name: undefined,
      is_marine: false,
      item_count: 0,
      display_name: "",
    });

    expect(result).toStrictEqual({
      homeTown: null,
      crewName: undefined,
      isMarine: false,
      itemCount: 0,
      displayName: "",
    });
  });

  it.each([{}, []])("preserves empty collection %j", (input) => {
    expect(camelCaseKeys(input)).toStrictEqual(input);
  });

  it.each([
    new Date("2026-09-23T00:00:00.000Z"),
    new Map([["crew_name", "Straw Hat Pirates"]]),
    new Set(["Nami"]),
    /crew_name/,
  ])("preserves non-plain objects by reference: %s", (input) => {
    expect(camelCaseKeys(input)).toBe(input);
    expect(camelCaseKeys({ crew_data: input })).toStrictEqual({ crewData: input });
    expect(Object.values(camelCaseKeys({ crew_data: input }))[0]).toBe(input);
  });

  it("converts frozen objects and arrays without mutating them", () => {
    const member = Object.freeze({ full_name: "Nami" });
    const input = Object.freeze({ crew_members: Object.freeze([member]) });

    const result = camelCaseKeys(input);

    expect(result).toStrictEqual({ crewMembers: [{ fullName: "Nami" }] });
    expect(result).not.toBe(input);
    expect(input).toStrictEqual({ crew_members: [{ full_name: "Nami" }] });
  });
});
