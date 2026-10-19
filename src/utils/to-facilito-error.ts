import { codes, type BusinessError, type ErrorCode } from "../contracts/business-error.ts";
import type { FacilitoError } from "../contracts/facilito-error.ts";

const ERROR_STATUS_CODES: Record<ErrorCode, number> = Object.freeze({
  [codes.internalServerError]: 500,
  [codes.rateLimitExceeded]: 429,
  [codes.validationError]: 400,
  [codes.forbiddenError]: 403,
  [codes.accountNotProvisioned]: 403,
  [codes.invalidOAuthToken]: 401,
  [codes.syncTokenInvalid]: 400,
  [codes.syncUnavailable]: 503,
  [codes.conflictError]: 409,
  [codes.collectionNameAlreadyExists]: 409,
  [codes.skuAlreadyExists]: 409,
  [codes.barcodeAlreadyExists]: 409,
  [codes.priceBelowUnitCost]: 400,
  [codes.paymentInsufficient]: 400,
  [codes.stockInsufficient]: 409,
  [codes.resourceNotFound]: 404,
  [codes.locationLimitExceeded]: 403,
  [codes.concurrentUpdateConflict]: 409,
  [codes.idempotencyKeyMismatch]: 409,
  [codes.idempotencyRequestInProgress]: 409,
  [codes.idempotencyUnavailable]: 503,
});

function toFacilitoError({ requestId, error }: { requestId: string; error: Error | BusinessError }): FacilitoError {
  if (error instanceof Error) {
    return {
      requestId,
      status: ERROR_STATUS_CODES[codes.internalServerError],
      code: codes.internalServerError,
      message: error.message,
      details: [],
    } satisfies FacilitoError;
  }

  const response: FacilitoError = {
    requestId,
    status: ERROR_STATUS_CODES[error.code],
    code: error.code,
    message: error.message,
    details: error.details,
  };

  return response;
}

export { ERROR_STATUS_CODES, toFacilitoError };
