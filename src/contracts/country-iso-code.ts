import z from "zod";

const CountryIsoCode = z.union([
  z.literal("zz"),
  z.literal("bz"),
  z.literal("co"),
  z.literal("cr"),
  z.literal("gt"),
  z.literal("hn"),
  z.literal("mx"),
  z.literal("ni"),
  z.literal("pa"),
  z.literal("sv"),
  z.literal("ve"),
]);

type CountryIsoCode = z.infer<typeof CountryIsoCode>;

export { CountryIsoCode };
