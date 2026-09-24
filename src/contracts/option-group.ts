import z from "zod";
import { Option } from "./option.ts";

const OptionGroup = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  options: Option.array().default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

type OptionGroup = z.infer<typeof OptionGroup>;

export { OptionGroup };
