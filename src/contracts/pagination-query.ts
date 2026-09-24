import { z } from "zod";

const PaginationRequest = z.object({
  limit: z.coerce.number().positive().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const ScopedPaginationRequest = PaginationRequest.extend({
  merchantId: z.string(),
});

type PaginationRequest = z.infer<typeof PaginationRequest>;

type ScopedPaginationRequest = z.infer<typeof ScopedPaginationRequest>;

export { PaginationRequest, ScopedPaginationRequest };
