import { createMiddleware } from "hono/factory";
import type { MipymeEnv } from "../types.ts";
import { snakeCaseKeys } from "../utils/snake-case-keys.ts";

function snakeCase() {
  return createMiddleware<MipymeEnv>(async (ctx, next) => {
    await next();

    const isJSONResponse = ctx.res.headers.get("Content-Type")?.startsWith("application/json") === true;
    const shouldSkipCasing = ctx.res.status === 204 || ctx.res.body === null || !isJSONResponse;
    if (shouldSkipCasing) {
      return;
    }

    const body: unknown = await ctx.res.clone().json();
    const headers = new Headers(ctx.res.headers);
    headers.delete("Content-Length");

    ctx.res = new Response(JSON.stringify(snakeCaseKeys(body)), {
      headers,
      status: ctx.res.status,
      statusText: ctx.res.statusText,
    });
  });
}

export { snakeCase };
