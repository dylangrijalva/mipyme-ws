import z from "zod";

const Option = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  position: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

type Option = z.infer<typeof Option>;

export { Option };
