import { RedisContainer } from "@testcontainers/redis";
import { contextStorage } from "hono/context-storage";
import { createMiddleware } from "hono/factory";
import { Redis } from "ioredis";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { rateLimiter } from "../../src/middlewares/rate-limiter.ts";
import { MipymeHono, type MipymeEnv } from "../../src/types.ts";
import { ok } from "../../src/utils/result.ts";
import { toHttpResponse } from "../../src/utils/to-http-response.ts";

const REQUEST_ID = "req_going_merry_000001";
const KEY = "rate-limit:ships";
const WINDOW_SECONDS = 60;

function createApp(cache: Redis) {
  const handler = vi.fn(() => toHttpResponse(ok({ name: "Thousand Sunny" }), 201));
  const app = new MipymeHono();

  app.use(contextStorage());
  app.use(
    createMiddleware<MipymeEnv>((ctx, next) => {
      ctx.set("requestId", REQUEST_ID);
      ctx.set("logger", pino({ enabled: false }));
      ctx.set("cache", cache);
      return next();
    }),
  );
  app.post("/ships", rateLimiter({ key: () => KEY, limit: 2, windowInSeconds: WINDOW_SECONDS }), handler);

  return { app, handler };
}

describe("rateLimiter", () => {
  it("allows requests up to the limit and reports the remaining window when rejecting the next request", async ({
    onTestFinished,
  }) => {
    const container = await new RedisContainer("redis:8.2").start();
    onTestFinished(() => container.stop().then(() => undefined));
    const cache = new Redis(container.getConnectionUrl());
    onTestFinished(() => cache.disconnect());
    const { app, handler } = createApp(cache);

    const startedAt = performance.now();
    const first = await app.request("/ships", { method: "POST" });
    const initialTtl = await cache.ttl(KEY);
    const elapsedSeconds = Math.ceil((performance.now() - startedAt) / 1000);
    // Model a partially elapsed window without sleeping.
    await cache.expire(KEY, 42);
    const second = await app.request("/ships", { method: "POST" });
    const ttlBeforeRejection = await cache.ttl(KEY);
    const blocked = await app.request("/ships", { method: "POST" });

    const ttlAfterRejection = await cache.ttl(KEY);

    expect(first.status).toBe(201);
    expect(first.headers.get("RateLimit-Limit")).toBe("2");
    expect(first.headers.get("RateLimit-Remaining")).toBe("1");
    expect(first.headers.get("RateLimit-Reset")).toBe(String(WINDOW_SECONDS));
    expect(first.headers.get("Retry-After")).toBeNull();
    expect(await first.json()).toStrictEqual({ name: "Thousand Sunny" });
    expect(second.status).toBe(201);
    expect(second.headers.get("RateLimit-Remaining")).toBe("0");
    expect(initialTtl).toBeGreaterThanOrEqual(WINDOW_SECONDS - elapsedSeconds);
    expect(initialTtl).toBeLessThanOrEqual(WINDOW_SECONDS);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Content-Type")).toMatch(/^application\/json/);
    const retryAfter = Number(blocked.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(ttlBeforeRejection).toBeLessThanOrEqual(42);
    expect(retryAfter).toBeGreaterThanOrEqual(ttlAfterRejection);
    expect(retryAfter).toBeLessThanOrEqual(ttlBeforeRejection);
    expect(blocked.headers.get("RateLimit-Limit")).toBe("2");
    expect(blocked.headers.get("RateLimit-Remaining")).toBe("0");
    expect(blocked.headers.get("RateLimit-Reset")).toBe(String(retryAfter));
    expect(await blocked.json()).toMatchObject({ requestId: REQUEST_ID, status: 429, code: "rate_limit_exceeded" });
    expect(handler).toHaveBeenCalledTimes(2);
  }, 60_000);
});
