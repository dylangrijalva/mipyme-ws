import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import { codes } from "../contracts/business-error.ts";
import type { MipymeEnv } from "../types.ts";
import { err } from "../utils/result.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

type RateLimiterConfig = {
  key: (ctx: Context<MipymeEnv>) => string;
  limit: number;
  windowInSeconds: number;
};

const DEFAULT_RATE_LIMIT_CONFIG = {
  limit: 100,
  windowInSeconds: 60,
};

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("TTL", KEYS[1])
if ttl < 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

function createAuthScopedKey(ctx: Context<MipymeEnv>): string {
  return `rate-limit:${ctx.req.method}:${routePath(ctx, -1)}:${ctx.var.claims.sub}`;
}

function createPublicScopedKey(ctx: Context<MipymeEnv>): string {
  const remoteAddress = getConnInfo(ctx).remote.address ?? "unknown";
  return `rate-limit:${ctx.req.method}:${routePath(ctx, -1)}:${remoteAddress}`;
}

function createAuthOperationScopedKey(operation: string): (ctx: Context<MipymeEnv>) => string {
  return (ctx) => `rate-limit:${operation}:${ctx.var.claims.sub}`;
}

function rateLimiter(config: RateLimiterConfig) {
  return createMiddleware<MipymeEnv>(async (ctx, next) => {
    const key = config.key(ctx);
    const count = Number(await ctx.var.cache.eval(RATE_LIMIT_SCRIPT, 1, key, config.windowInSeconds));
    const isFirstAttempt = count === 1;

    if (isFirstAttempt) {
      ctx.var.logger.debug(
        { key, limit: config.limit, windowInSeconds: config.windowInSeconds },
        "Rate limit window started",
      );
    }

    const rateLimitRemaining = Math.max(config.limit - count, 0);
    const rateLimitReset = isFirstAttempt ? config.windowInSeconds : await ctx.var.cache.ttl(key);

    ctx.header("RateLimit-Limit", config.limit.toString());
    ctx.header("RateLimit-Remaining", rateLimitRemaining.toString());
    ctx.header("RateLimit-Reset", Math.max(rateLimitReset, 0).toString());

    const hasExceededLimit = count > config.limit;
    if (hasExceededLimit) {
      const retryAfter = Math.max(rateLimitReset, 0);
      ctx.header("Retry-After", retryAfter.toString());
      ctx.var.logger.warn({ key, count, limit: config.limit, retryAfter }, "Rate limit exceeded");

      return toHttpResponse(
        err({
          code: codes.rateLimitExceeded,
          message:
            "The request limit has been reached. Wait for the duration in the Retry-After header before trying again.",
          details: [],
        }),
      );
    }

    return next();
  });
}

export {
  DEFAULT_RATE_LIMIT_CONFIG,
  createAuthOperationScopedKey,
  createAuthScopedKey,
  createPublicScopedKey,
  rateLimiter,
  type RateLimiterConfig,
};
