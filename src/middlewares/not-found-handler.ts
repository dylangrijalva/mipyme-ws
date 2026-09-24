import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { codes } from "../contracts/business-error.ts";
import type { FacilitoEnv } from "../types.ts";
import { toFacilitoError } from "../utils/to-facilito-error.ts";

function notFoundHandler() {
  return async (ctx: Context<FacilitoEnv>) => {
    const error = toFacilitoError({
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
