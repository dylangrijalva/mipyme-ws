import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import { performance } from "perf_hooks";
import type { FacilitoEnv } from "../types.ts";

function logging() {
  return createMiddleware<FacilitoEnv>(async (ctx, next) => {
    const start = performance.now();
    await next();

    const responseTimeMs = +(performance.now() - start).toFixed(2);
    const { path, method } = ctx.req;
    const matchedRoute = routePath(ctx, -1);
    const route = matchedRoute === "*" || matchedRoute === "/*" ? path : matchedRoute || path;
    const userAgent = ctx.req.header("User-Agent") ?? "-";
    const referrer = ctx.req.header("Referer") ?? "-";
    const contentLength = ctx.res.headers.get("Content-Length") ?? "-";
    const { status } = ctx.res;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    const message = `"${method} ${path}" ${status} ${contentLength} "${referrer}" "${userAgent}" ${responseTimeMs.toFixed(2)} ms`;

    ctx.var.logger[level](
      {
        method,
        path,
        route,
        status,
        userAgent,
        referrer,
        contentLength,
        responseTimeMs,
      },
      message,
    );
  });
}

export { logging };
