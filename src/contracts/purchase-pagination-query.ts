import Big from "big.js";
import z from "zod";
import { ObjectId } from "./object-id.ts";
import { PaginationRequest } from "./pagination-query.ts";
import { PurchaseStatus } from "./purchase-status.ts";

const PurchaseCursor = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((value) => Buffer.from(value, "base64url").toString("base64url") === value, "Invalid purchases cursor.")
  .transform((value) => Buffer.from(value, "base64url").toString("utf8").split("|"))
  .pipe(z.tuple([z.iso.datetime({ precision: 6 }), ObjectId]))
  .transform(([createdAt, id]) => ({ createdAt: createdAt.replace("T", " ").replace("Z", ""), id }));

const CreatedDateRange = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

const PurchasePaginationRequest = PaginationRequest.extend({
  cursor: PurchaseCursor.optional(),
  locationId: ObjectId.optional(),
  status: PurchaseStatus.optional(),
  supplierId: ObjectId.optional(),
  ...CreatedDateRange.shape,
})
  .refine(
    (request) =>
      !request.from || !request.to || timestampMicroseconds(request.from).lte(timestampMicroseconds(request.to)),
    {
      message: "The end of the created date range must be on or after its start.",
      path: ["to"],
      when: (payload) => CreatedDateRange.safeParse(payload.value).success,
    },
  )
  .transform(({ from, to, ...request }) => ({
    ...request,
    ...(from ? { from: databaseTimestamp(from, Big.roundUp) } : {}),
    ...(to ? { to: databaseTimestamp(to, Big.roundDown) } : {}),
  }));

function timestampMicroseconds(value: string): Big {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? "0";
  return new Big(new Date(value).getTime()).times(1000).plus(new Big(`0.${fraction}`).times(1000000).mod(1000));
}

function databaseTimestamp(value: string, rounding: typeof Big.roundUp | typeof Big.roundDown): string {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? "0";
  const microseconds = new Big(`0.${fraction}`).times(1000000).round(0, rounding);
  const date = new Date(value);
  date.setUTCMilliseconds(0);
  if (microseconds.eq(1000000)) date.setUTCSeconds(date.getUTCSeconds() + 1);
  return `${date.toISOString().slice(0, 19).replace("T", " ")}.${microseconds.mod(1000000).toFixed(0).padStart(6, "0")}`;
}

type PurchasePaginationRequest = z.infer<typeof PurchasePaginationRequest>;

export { PurchasePaginationRequest };
