import { parsePhoneNumberFromString } from "libphonenumber-js";
import { CountryIsoCode } from "../contracts/country-iso-code.ts";

function resolvePhoneNumberCountry(phone: string): CountryIsoCode | null {
  const country = parsePhoneNumberFromString(phone)?.country?.toLowerCase();
  const { success, data } = CountryIsoCode.safeParse(country);
  if (!success || data === "zz") {
    return null;
  }

  return data;
}

export { resolvePhoneNumberCountry };
