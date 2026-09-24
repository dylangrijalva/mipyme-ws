import z from "zod";
import { CountryIsoCode } from "./country-iso-code.ts";

const Merchant = z.object({
  id: z.string(),
  name: z.string(),
  country: CountryIsoCode,
  createdAt: z.date(),
  updatedAt: z.date(),
});

type Merchant = z.infer<typeof Merchant>;

export { Merchant };
