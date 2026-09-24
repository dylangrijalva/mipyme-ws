import { createMiddleware } from "hono/factory";
import type { FacilitoEnv } from "../types.ts";

function devGuard() {
  return createMiddleware<FacilitoEnv>(async (ctx, next) => {
    const isDevelopment = ctx.var.env.NODE_ENV === "development";
    if (!isDevelopment) {
      return ctx.notFound();
    }

    return next();
  });
}

export { devGuard };
