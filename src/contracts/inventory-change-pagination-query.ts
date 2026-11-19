import Big from "big.js";
import z from "zod";
import { databaseTimestamp, timestampMicroseconds } from "../utils/database-timestamp.ts";
import { splitDistinct } from "../utils/split-distinct.ts";
import { InventoryMovementReason } from "./inventory-movement-reason.ts";
import { ObjectId } from "./object-id.ts";
import { PaginationRequest } from "./pagination-query.ts";

const MAX_FILTER_VALUES = 100;

const InventoryChangeCursor = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine(
    (value) => Buffer.from(value, "base64url").toString("base64url") === value,
    "Invalid inventory changes cursor.",
  )
  .transform((value) => Buffer.from(value, "base64url").toString("utf8").split("|"))
  .pipe(z.tuple([z.iso.datetime({ precision: 6 }), ObjectId]))
  .transform(([occurredAt, id]) => ({ occurredAt: occurredAt.replace("T", " ").replace("Z", ""), id }));

function commaSeparated<TValue extends z.ZodType<unknown, string>>(value: TValue) {
  return z
    .string()
    .transform((list) => splitDistinct(list, ","))
    .pipe(z.array(value).min(1).max(MAX_FILTER_VALUES));
}

const OccurredDateRange = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

const InventoryChangePaginationRequest = PaginationRequest.extend({
  cursor: InventoryChangeCursor.optional(),
  variantIds: commaSeparated(ObjectId).optional(),
  locationIds: commaSeparated(ObjectId).optional(),
  reasons: commaSeparated(InventoryMovementReason).optional(),
  createdByIds: commaSeparated(ObjectId).optional(),
  ...OccurredDateRange.shape,
})
  .refine(
    (request) =>
      !request.from || !request.to || timestampMicroseconds(request.from).lte(timestampMicroseconds(request.to)),
    {
      message: "The end of the occurred date range must be on or after its start.",
      path: ["to"],
      when: (payload) => OccurredDateRange.safeParse(payload.value).success,
    },
  )
  .transform(({ from, to, ...request }) => ({
    ...request,
    ...(from ? { from: databaseTimestamp(from, Big.roundUp) } : {}),
    ...(to ? { to: databaseTimestamp(to, Big.roundDown) } : {}),
  }));

type InventoryChangePaginationRequest = z.infer<typeof InventoryChangePaginationRequest>;

export { InventoryChangePaginationRequest };
