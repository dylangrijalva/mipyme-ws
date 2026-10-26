import { getContext } from "hono/context-storage";
import type { SuccessStatusCode } from "hono/utils/http-status";
import type { BusinessError } from "../contracts/business-error.ts";
import type { MipymeEnv } from "../types.ts";
import type { Result } from "./result.ts";
import { toMipymeError } from "./to-mipyme-error.ts";

function toHttpResponse(result: Result<unknown, BusinessError>, status: SuccessStatusCode = 200): Response {
  if (!result.success) {
    const ctx = getContext<MipymeEnv>();
    const apiError = toMipymeError({ requestId: ctx.var.requestId, error: result.error });
    return Response.json(apiError, { status: apiError.status });
  }

  if (status === 204 || status === 205) {
    return new Response(null, { status });
  }

  return Response.json(result.value, { status });
}

export { toHttpResponse };
