import z from "zod";

const codes = {
  internalServerError: "internal_server_error",
  rateLimitExceeded: "rate_limit_exceeded",
  forbiddenError: "forbidden_error",
  accountNotProvisioned: "account_not_provisioned",
  validationError: "validation_error",
  conflictError: "conflict_error",
  resourceNotFound: "resource_not_found",
  invalidOAuthToken: "invalid_oauth_token",
  syncTokenInvalid: "sync_token_invalid",
  syncUnavailable: "sync_unavailable",
  concurrentUpdateConflict: "concurrent_update_conflict",
  idempotencyKeyMismatch: "idempotency_key_mismatch",
  idempotencyRequestInProgress: "idempotency_request_in_progress",
  idempotencyUnavailable: "idempotency_unavailable",
  collectionNameAlreadyExists: "collection_name_already_exists",
  skuAlreadyExists: "sku_already_exists",
  barcodeAlreadyExists: "barcode_already_exists",
  phoneNumberAlreadyExists: "phone_number_already_exists",
  priceBelowUnitCost: "price_below_unit_cost",
  paymentInsufficient: "payment_insufficient",
  stockInsufficient: "stock_insufficient",
  locationLimitExceeded: "location_limit_exceeded",
} as const;

type ErrorCode = (typeof codes)[keyof typeof codes];

const BusinessError = z.object({
  code: z.union(Object.values(codes).map((value) => z.literal(value))),
  message: z.string(),
  details: z.array(z.object({ code: z.string(), message: z.string(), field: z.string().optional() })),
});

type BusinessError = z.infer<typeof BusinessError>;

const INTERNAL_SEVER_ERROR: BusinessError = Object.freeze({
  code: codes.internalServerError,
  message: "The request could not be completed because of an internal error. Contact support with the request_id.",
  details: [],
});

export { BusinessError, codes, INTERNAL_SEVER_ERROR, type ErrorCode };
