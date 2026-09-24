import { describe, expect, it } from "vitest";
import { snakeCaseKeys } from "../../src/utils/snake-case-keys.ts";

describe("snakeCaseKeys", () => {
  it("converts keys in deeply nested objects", () => {
    const input = {
      crewName: "Straw Hat Pirates",
      captainDetails: {
        fullName: "Monkey D. Luffy",
        homeVillage: { locationName: "Foosha Village" },
      },
    };

    const result = snakeCaseKeys(input);

    expect(result).toStrictEqual({
      crew_name: "Straw Hat Pirates",
      captain_details: {
        full_name: "Monkey D. Luffy",
        home_village: { location_name: "Foosha Village" },
      },
    });
  });

  it("converts keys in a top-level array, including nested arrays", () => {
    const input = [{ fullName: "Nico Robin" }, [{ fullName: "Roronoa Zoro" }], "Nami", 0, false, null, undefined];

    const result = snakeCaseKeys(input);

    expect(result).toStrictEqual([
      { full_name: "Nico Robin" },
      [{ full_name: "Roronoa Zoro" }],
      "Nami",
      0,
      false,
      null,
      undefined,
    ]);
  });

  it.each([null, undefined, "", 0, false, 10n, Symbol("luffy")])(
    "returns the primitive value %s unchanged",
    (input) => {
      const result = snakeCaseKeys(input);

      expect(result).toBe(input);
    },
  );

  it("preserves null, undefined, and falsy property values", () => {
    const input = { homeTown: null, crewName: undefined, isMarine: false, itemCount: 0, displayName: "" };

    const result = snakeCaseKeys(input);

    expect(result).toStrictEqual({
      home_town: null,
      crew_name: undefined,
      is_marine: false,
      item_count: 0,
      display_name: "",
    });
  });

  it.each([{}, []])("preserves the shape of an empty collection %j", (input) => {
    const result = snakeCaseKeys(input);

    expect(result).toStrictEqual(input);
  });

  it("leaves lowercase and snake_case keys unchanged", () => {
    const input = { name: "Nami", crew_name: "Straw Hat Pirates", "": "Water 7" };

    const result = snakeCaseKeys(input);

    expect(result).toStrictEqual(input);
  });

  it("adds an underscore before each uppercase letter, including leading capitals and acronyms", () => {
    const input = { FullName: "Nico Robin", crewID: "strawhatpirates" };

    const result = snakeCaseKeys(input);

    expect(result).toStrictEqual({ _full_name: "Nico Robin", crew_i_d: "strawhatpirates" });
  });

  it.each([new Map([["crewName", "Straw Hat Pirates"]]), /Straw Hat Pirates/])(
    "preserves non-plain objects by reference: %s",
    (input) => {
      const result = snakeCaseKeys(input);

      expect(result).toBe(input);
    },
  );

  it("preserves nested non-plain objects by reference while converting their property keys", () => {
    const createdAt = new Date("2025-06-16T00:00:00.000Z");
    const crewMembers = new Set(["Nami", "Nico Robin"]);

    const result = snakeCaseKeys({ createdAt, crewMembers });

    expect(result).toStrictEqual({ created_at: createdAt, crew_members: crewMembers });
    expect(Object.values(result)[0]).toBe(createdAt);
    expect(Object.values(result)[1]).toBe(crewMembers);
  });

  it("converts frozen objects and arrays without mutating the input", () => {
    const crewMember = Object.freeze({ fullName: "Nami" });
    const crewMembers = Object.freeze([crewMember]);
    const input = Object.freeze({ crewMembers });

    const result = snakeCaseKeys(input);

    expect(result).toStrictEqual({ crew_members: [{ full_name: "Nami" }] });
    expect(result).not.toBe(input);
    expect(input).toStrictEqual({ crewMembers: [{ fullName: "Nami" }] });
  });
});
