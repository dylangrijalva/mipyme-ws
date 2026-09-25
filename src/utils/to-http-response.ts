import { getContext } from "hono/context-storage";
import type { SuccessStatusCode } from "hono/utils/http-status";
import type { BusinessError } from "../contracts/business-error.ts";
import type { FacilitoEnv } from "../types.ts";
import type { Result } from "./result.ts";
import { toFacilitoError } from "./to-facilito-error.ts";

function toHttpResponse(result: Result<unknown, BusinessError>, status: SuccessStatusCode = 200): Response {
  if (!result.success) {
    const ctx = getContext<FacilitoEnv>();
    const apiError = toFacilitoError({ requestId: ctx.var.requestId, error: result.error });
    return Response.json(apiError, { status: apiError.status });
  }

  if (status === 204 || status === 205) {
    return new Response(null, { status });
  }

  return Response.json(result.value, { status });
}

export { toHttpResponse };
