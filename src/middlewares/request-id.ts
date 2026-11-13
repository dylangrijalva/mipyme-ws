import { createMiddleware } from "hono/factory";
import type { MipymeEnv } from "../types.ts";
import { generateId } from "../utils/generate-id.ts";

function requestId() {
  return createMiddleware<MipymeEnv>(async (ctx, next) => {
    const requestId = ctx.req.header("x-request-id")?.trim() || generateId({ model: "request", length: 21 });
    ctx.set("requestId", requestId);

    const { logger } = ctx.var;
    ctx.set("logger", logger.child({ requestId }));

    await next();

    // Responses returned as raw `Response` objects (e.g. from third-party middleware) skip headers set
    // through `ctx.header`, so the header is stamped on the final response to cover every exit path.
    ctx.res.headers.set("X-Request-ID", requestId);
  });
}

export { requestId };
