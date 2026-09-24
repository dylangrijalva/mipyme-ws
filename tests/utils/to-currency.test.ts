import { describe, expect, it } from "vitest";
import { toCurrency } from "../../src/utils/to-currency.ts";

describe("toCurrency", () => {
  it.each([
    ["zz", "xxx"],
    ["ar", "ars"],
    ["bo", "bob"],
    ["br", "brl"],
    ["bz", "bzd"],
    ["cl", "clp"],
    ["co", "cop"],
    ["cr", "crc"],
    ["cu", "cup"],
    ["do", "dop"],
    ["ec", "usd"],
    ["gt", "gtq"],
    ["hn", "hnl"],
    ["ht", "htg"],
    ["mx", "mxn"],
    ["ni", "nio"],
    ["pa", "pab"],
    ["pe", "pen"],
    ["pr", "usd"],
    ["py", "pyg"],
    ["sv", "usd"],
    ["uy", "uyu"],
    ["ve", "ves"],
  ] as const)("maps country %s to currency %s", (country, expected) => {
    const result = toCurrency(country);

    expect(result).toBe(expected);
  });
});
