import type { CountryIsoCode } from "../contracts/country-iso-code.ts";
import type { CurrencyCode } from "../contracts/currency-code.ts";

function toCurrency(country: CountryIsoCode): CurrencyCode {
  const CountryToCurrencyMap: Record<CountryIsoCode, CurrencyCode> = {
    zz: "xxx",
    bz: "bzd",
    co: "cop",
    cr: "crc",
    gt: "gtq",
    hn: "hnl",
    mx: "mxn",
    ni: "nio",
    pa: "pab",
    sv: "usd",
    ve: "ves",
  };

  return CountryToCurrencyMap[country];
}

export { toCurrency };
