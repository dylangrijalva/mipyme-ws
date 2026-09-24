import z from "zod";

const Collection = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

type Collection = z.infer<typeof Collection>;

export { Collection };
