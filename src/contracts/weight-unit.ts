import z from "zod";

const WeightUnit = z.union([z.literal("each"), z.literal("g"), z.literal("kg"), z.literal("oz"), z.literal("lb")]);

type WeightUnit = z.infer<typeof WeightUnit>;

export { WeightUnit };
