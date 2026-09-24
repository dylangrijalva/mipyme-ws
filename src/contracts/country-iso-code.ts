import z from "zod";

const CountryIsoCode = z.union([
  z.literal("zz"),
  z.literal("ar"),
  z.literal("bo"),
  z.literal("br"),
  z.literal("bz"),
  z.literal("cl"),
  z.literal("co"),
  z.literal("cr"),
  z.literal("cu"),
  z.literal("do"),
  z.literal("ec"),
  z.literal("gt"),
  z.literal("hn"),
  z.literal("ht"),
  z.literal("mx"),
  z.literal("ni"),
  z.literal("pa"),
  z.literal("pe"),
  z.literal("pr"),
  z.literal("py"),
  z.literal("sv"),
  z.literal("uy"),
  z.literal("ve"),
]);

type CountryIsoCode = z.infer<typeof CountryIsoCode>;

export { CountryIsoCode };
