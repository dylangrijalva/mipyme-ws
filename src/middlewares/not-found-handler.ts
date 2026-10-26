import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { codes } from "../contracts/business-error.ts";
import type { MipymeEnv } from "../types.ts";
import { toMipymeError } from "../utils/to-mipyme-error.ts";

function notFoundHandler() {
  return async (ctx: Context<MipymeEnv>) => {
    const error = toMipymeError({
      requestId: ctx.var.requestId,
      error: {
        code: codes.resourceNotFound,
        message: `No endpoint matches ${ctx.req.method} ${ctx.req.path}. Check the HTTP method and URL.`,
        details: [],
      },
    });

    return ctx.json(error, error.status as ContentfulStatusCode);
  };
}

export { notFoundHandler };
