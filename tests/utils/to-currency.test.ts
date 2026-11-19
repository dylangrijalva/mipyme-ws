import { describe, expect, it } from "vitest";
import { toCurrency } from "../../src/utils/to-currency.ts";

describe("toCurrency", () => {
  it.each([
    ["zz", "xxx"],
    ["bz", "bzd"],
    ["co", "cop"],
    ["cr", "crc"],
    ["gt", "gtq"],
    ["hn", "hnl"],
    ["mx", "mxn"],
    ["ni", "nio"],
    ["pa", "pab"],
    ["sv", "usd"],
    ["ve", "ves"],
  ] as const)("maps country %s to currency %s", (country, expected) => {
    const result = toCurrency(country);

    expect(result).toBe(expected);
  });
});
