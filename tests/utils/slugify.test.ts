import { describe, expect, it } from "vitest";
import { slugify } from "../../src/utils/slugify.ts";

describe("slugify", () => {
  it.each([
    ["Straw Hat Pirates", "straw-hat-pirates"],
    ["  Water\t7\nShipyard  ", "water-7-shipyard"],
    ["---Nico---Robin---", "nico-robin"],
    ["Café de Sanji", "cafe-de-sanji"],
    ["Cafe\u0301 de Sanji", "cafe-de-sanji"],
    ["Ä Ö Ü ä ö ü ß ẞ", "ae-oe-ue-ae-oe-ue-ss-ss"],
    ["Nami's [Map] / (East Blue)! ©®™", "namis-map-east-blue"],
    ["straw-hat-pirates", "straw-hat-pirates"],
    ["", ""],
    [" \t\n ", ""],
    ["---!@#$---", ""],
  ])("converts %j to %j", (input, expected) => {
    const result = slugify(input);

    expect(result).toBe(expected);
  });
});
