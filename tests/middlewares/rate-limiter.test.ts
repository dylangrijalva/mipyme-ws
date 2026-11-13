import { contextStorage } from "hono/context-storage";
import { createMiddleware } from "hono/factory";
import type { Redis } from "ioredis";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { rateLimiter } from "../../src/middlewares/rate-limiter.ts";
import { MipymeHono, type MipymeEnv } from "../../src/types.ts";
import { ok } from "../../src/utils/result.ts";
import { toHttpResponse } from "../../src/utils/to-http-response.ts";

const REQUEST_ID = "req_going_merry_000001";
const REMAINING_WINDOW_SECONDS = 42;

// Mirrors the INCR/TTL contract of the Lua script without needing a Redis server.
function createCacheStub(): Redis {
  const counts = new Map<string, number>();
  const cache = {
    eval: (_script: string, _numberOfKeys: number, key: string) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return Promise.resolve(count);
    },
    ttl: () => Promise.resolve(REMAINING_WINDOW_SECONDS),
  };
  return cache as unknown as Redis;
}

function createApp(limit: number) {
  const handler = vi.fn(() => toHttpResponse(ok({ name: "Thousand Sunny" }), 201));
  const cache = createCacheStub();
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
  app.post("/ships", rateLimiter({ key: () => "rate-limit:ships", limit, windowInSeconds: 60 }), handler);

  return { app, handler };
}

describe("rateLimiter", () => {
  it("keeps the rate-limit headers on a response built by toHttpResponse", async () => {
    const { app } = createApp(2);

    const response = await app.request("/ships", { method: "POST" });

    expect(response.status).toBe(201);
    expect(response.headers.get("RateLimit-Limit")).toBe("2");
    expect(response.headers.get("RateLimit-Remaining")).toBe("1");
    expect(response.headers.get("RateLimit-Reset")).toBe("60");
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(await response.json()).toStrictEqual({ name: "Thousand Sunny" });
  });

  it("rejects a request over the limit with Retry-After and rate-limit headers", async () => {
    const { app, handler } = createApp(1);

    await app.request("/ships", { method: "POST" });
    const response = await app.request("/ships", { method: "POST" });

    expect(response.status).toBe(429);
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(response.headers.get("Retry-After")).toBe(String(REMAINING_WINDOW_SECONDS));
    expect(response.headers.get("RateLimit-Limit")).toBe("1");
    expect(response.headers.get("RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("RateLimit-Reset")).toBe(String(REMAINING_WINDOW_SECONDS));
    expect(await response.json()).toMatchObject({ requestId: REQUEST_ID, status: 429, code: "rate_limit_exceeded" });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
