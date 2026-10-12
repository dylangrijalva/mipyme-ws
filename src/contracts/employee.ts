import z from "zod";
import { splitDistinct } from "../utils/split-distinct.ts";
import { Decimal } from "./decimal.ts";

const PERMISSIONS_DELIMITER = " " as const;

const Employee = z.object({
  id: z.string(),
  name: z.string(),
  isOwner: z.boolean(),
  maxDiscountRate: Decimal,
  status: z.union([z.literal("invited"), z.literal("enabled"), z.literal("disabled")]),
  permissions: z
    .string()
    .nullish()
    .transform((value) => splitDistinct(value, PERMISSIONS_DELIMITER)),
  account: z.object({ id: z.string(), email: z.string() }).nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});

type Employee = z.infer<typeof Employee>;

export { Employee };
