import { getContext } from "hono/context-storage";
import type { ContentfulStatusCode, SuccessStatusCode } from "hono/utils/http-status";
import type { BusinessError } from "../contracts/business-error.ts";
import type { MipymeEnv } from "../types.ts";
import type { Result } from "./result.ts";
import { toMipymeError } from "./to-mipyme-error.ts";

// Responses are built through the request context so headers set earlier with `ctx.header`
// (e.g. rate-limit headers, Cache-Control) are kept; a raw `Response` would silently drop them.
function toHttpResponse(result: Result<unknown, BusinessError>, status: SuccessStatusCode = 200): Response {
  const ctx = getContext<MipymeEnv>();

  if (!result.success) {
    const apiError = toMipymeError({ requestId: ctx.var.requestId, error: result.error });
    return ctx.json(apiError, apiError.status as ContentfulStatusCode);
  }

  if (status === 204 || status === 205) {
    return ctx.body(null, status);
  }

  return ctx.json(result.value, status);
}

export { toHttpResponse };
