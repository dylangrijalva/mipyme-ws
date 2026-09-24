import z from "zod";

const Supplier = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

type Supplier = z.infer<typeof Supplier>;

export { Supplier };
