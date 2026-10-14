import Big from "big.js";
import z from "zod";
import { ObjectId } from "./object-id.ts";
import { PaginationRequest } from "./pagination-query.ts";
import { SaleStatus } from "./sale-status.ts";

const SaleCursor = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((value) => Buffer.from(value, "base64url").toString("base64url") === value, "Invalid sales cursor.")
  .transform((value) => Buffer.from(value, "base64url").toString("utf8").split("|"))
  .pipe(z.tuple([z.iso.datetime({ precision: 6 }), ObjectId]))
  .transform(([createdAt, id]) => ({ createdAt: createdAt.replace("T", " ").replace("Z", ""), id }));

const BusinessDateRange = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

const SalePaginationRequest = PaginationRequest.extend({
  cursor: SaleCursor.optional(),
  locationId: ObjectId.optional(),
  status: SaleStatus.optional(),
  customerId: ObjectId.optional(),
  ...BusinessDateRange.shape,
})
  .refine(
    (request) =>
      !request.from || !request.to || timestampMilliseconds(request.from).lte(timestampMilliseconds(request.to)),
    {
      message: "The end of the business date range must be on or after its start.",
      path: ["to"],
      when: (payload) => BusinessDateRange.safeParse(payload.value).success,
    },
  )
  .transform(({ from, to, ...request }) => ({
    ...request,
    ...(from ? { from: new Date(new Date(from).getTime() + (timestampMilliseconds(from).mod(1).eq(0) ? 0 : 1)) } : {}),
    ...(to ? { to: new Date(to) } : {}),
  }));

function timestampMilliseconds(value: string): Big {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? "0";
  return new Big(new Date(value).getTime()).plus(new Big(`0.${fraction}`).times(1000).mod(1));
}

type SalePaginationRequest = z.infer<typeof SalePaginationRequest>;

export { SalePaginationRequest };
