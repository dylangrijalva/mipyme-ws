import z from "zod";

const Source = z.union([z.literal("pos.web"), z.literal("pos.android"), z.literal("pos.ios")]);

type Source = z.infer<typeof Source>;

export { Source };
