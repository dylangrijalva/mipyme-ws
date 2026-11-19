import { describe, expect, it } from "vitest";
import { resolvePhoneNumberCountry } from "../../src/utils/resolve-phone-number-country.ts";

describe("resolvePhoneNumberCountry", () => {
  it.each([
    ["+5016221234", "bz"],
    ["+573001234567", "co"],
    ["+50688881234", "cr"],
    ["+50255551234", "gt"],
    ["+50495551234", "hn"],
    ["+525512345678", "mx"],
    ["+50588881234", "ni"],
    ["+50761234567", "pa"],
    ["+50377771234", "sv"],
    ["+584121234567", "ve"],
  ])("resolves %s to the supported country %s", (phone, country) => {
    expect(resolvePhoneNumberCountry(phone)).toBe(country);
  });

  it.each([
    ["an Ecuadorian number", "+593987654321"],
    ["a United States number", "+12125551234"],
    ["a non-geographic number", "+80012345678"],
    ["a number with an unassigned calling code", "+99912345678"],
  ])("returns null for %s", (_scenario, phone) => {
    expect(resolvePhoneNumberCountry(phone)).toBeNull();
  });
});
