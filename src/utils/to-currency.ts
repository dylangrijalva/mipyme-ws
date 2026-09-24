import type { CountryIsoCode } from "../contracts/country-iso-code.ts";
import type { CurrencyCode } from "../contracts/currency-code.ts";

function toCurrency(country: CountryIsoCode): CurrencyCode {
  const CountryToCurrencyMap: Record<CountryIsoCode, CurrencyCode> = {
    zz: "xxx",
    ar: "ars",
    bo: "bob",
    br: "brl",
    bz: "bzd",
    cl: "clp",
    co: "cop",
    cr: "crc",
    cu: "cup",
    do: "dop",
    ec: "usd",
    gt: "gtq",
    hn: "hnl",
    ht: "htg",
    mx: "mxn",
    ni: "nio",
    pa: "pab",
    pe: "pen",
    pr: "usd",
    py: "pyg",
    sv: "usd",
    uy: "uyu",
    ve: "ves",
  };

  return CountryToCurrencyMap[country];
}

export { toCurrency };
