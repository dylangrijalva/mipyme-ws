import { describe, expect, it } from "vitest";
import type { BusinessError } from "../../src/contracts/business-error.ts";
import { toMipymeError } from "../../src/utils/to-mipyme-error.ts";

describe("toMipymeError", () => {
  const requestId = "req_00000000000000000000";

  it.each([new Error("Crew lookup failed"), new TypeError("Crew lookup failed")])(
    "converts a native %s to an internal server error",
    (error) => {
      const result = toMipymeError({ requestId, error });

      expect(result).toStrictEqual({
        requestId,
        status: 500,
        code: "internal_server_error",
        message: "Crew lookup failed",
        details: [],
      });
    },
  );

  it.each([
    ["internal_server_error", 500],
    ["rate_limit_exceeded", 429],
    ["validation_error", 400],
    ["invalid_oauth_token", 401],
    ["sync_token_invalid", 400],
    ["conflict_error", 409],
    ["collection_name_already_exists", 409],
    ["sku_already_exists", 409],
    ["barcode_already_exists", 409],
    ["price_below_unit_cost", 400],
    ["payment_insufficient", 400],
    ["stock_insufficient", 409],
    ["resource_not_found", 404],
    ["location_limit_exceeded", 403],
    ["concurrent_update_conflict", 409],
  ] as const)("maps business error %s to HTTP %i", (code, status) => {
    const error: BusinessError = { code, message: "The operation could not be completed.", details: [] };

    const result = toMipymeError({ requestId, error });

    expect(result).toStrictEqual({ requestId, status, code, message: error.message, details: [] });
  });

  it("preserves business error details with and without a field", () => {
    const details = [
      { code: "required", message: "Enter a product name.", field: "name" },
      { code: "invalid_product", message: "Check the product details." },
    ];
    const error: BusinessError = { code: "validation_error", message: "Check the submitted fields.", details };
    Object.freeze(error);

    const result = toMipymeError({ requestId, error });

    expect(result).toStrictEqual({
      requestId,
      status: 400,
      code: "validation_error",
      message: "Check the submitted fields.",
      details: [
        { code: "required", message: "Enter a product name.", field: "name" },
        { code: "invalid_product", message: "Check the product details." },
      ],
    });
  });
});
