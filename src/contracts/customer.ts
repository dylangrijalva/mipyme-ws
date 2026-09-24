import z from "zod";

const Customer = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

type Customer = z.infer<typeof Customer>;

export { Customer };
