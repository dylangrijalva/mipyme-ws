import { createMiddleware } from "hono/factory";
import type { FacilitoEnv } from "../types.ts";
import { generateId } from "../utils/generate-id.ts";

function requestId() {
  return createMiddleware<FacilitoEnv>((ctx, next) => {
    const requestId = ctx.req.header("x-request-id")?.trim() || generateId({ model: "request", length: 21 });
    ctx.set("requestId", requestId);
    ctx.header("X-Request-ID", requestId);

    const { logger } = ctx.var;
    ctx.set("logger", logger.child({ requestId }));

    return next();
  });
}

export { requestId };
