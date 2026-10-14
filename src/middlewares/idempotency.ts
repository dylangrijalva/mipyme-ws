import { fallback, handleAll } from "cockatiel";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { StatusCode } from "hono/utils/http-status";
import { createHash, randomUUID } from "node:crypto";
import z from "zod";
import { codes } from "../contracts/business-error.ts";
import type { FacilitoEnv } from "../types.ts";
import { err } from "../utils/result.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

type JsonValue = string | number | boolean | null | Array<JsonValue> | { [key: string]: JsonValue };

const IDEMPOTENCY_WINDOW_SECONDS = 24 * 60 * 60;
const REDIS_FALLBACK_POLICY = fallback(handleAll, () => null);
const REPLAY_HEADERS = ["content-type", "location", "content-language", "content-disposition", "cache-control", "etag"];

const ClaimResult = z.tuple([z.enum(["claimed", "existing", "invalid"]), z.string(), z.string()]);

const CachedResponse = z.object({
  status: z.number().int().min(200).max(599),
  body: z.string(),
  headers: z.array(z.tuple([z.string(), z.string()])),
});

const CLAIM_SCRIPT = `
local fingerprint = redis.call("HGET", KEYS[1], "fingerprint")
if fingerprint then
  local claimHasNoExpiry = redis.call("TTL", KEYS[1]) < 0
  if claimHasNoExpiry then
    return {"invalid", "", ""}
  end
  return {"existing", fingerprint, redis.call("HGET", KEYS[1], "response") or ""}
end
local claimAlreadyExists = redis.call("EXISTS", KEYS[1]) == 1
if claimAlreadyExists then
  return {"invalid", "", ""}
end
redis.call("HSET", KEYS[1], "fingerprint", ARGV[1], "owner", ARGV[2])
redis.call("EXPIRE", KEYS[1], ARGV[3])
return {"claimed", ARGV[1], ""}
`;

const COMPLETE_SCRIPT = `
local claimBelongsToAnotherRequest = redis.call("HGET", KEYS[1], "owner") ~= ARGV[1]
if claimBelongsToAnotherRequest then
  return 0
end
local claimShouldBeReleased = ARGV[2] == ""
if claimShouldBeReleased then
  return redis.call("DEL", KEYS[1])
end
redis.call("HSET", KEYS[1], "response", ARGV[2])
return 1
`;

async function requestFingerprint(ctx: Context<FacilitoEnv>): Promise<string> {
  const url = new URL(ctx.req.url);
  url.searchParams.sort();
  const requestBodyWasConsumed = ctx.req.raw.bodyUsed;
  const text = requestBodyWasConsumed ? null : await ctx.req.raw.clone().text();
  const requestBodyIsEmpty = text?.length === 0;
  const body: JsonValue =
    text === null ? await ctx.req.json<JsonValue>() : requestBodyIsEmpty ? null : JSON.parse(text);
  return createHash("sha256")
    .update(JSON.stringify([url.pathname, Array.from(url.searchParams.entries()), body]))
    .digest("hex");
}

function idempotency() {
  return createMiddleware<FacilitoEnv>(async (ctx, next) => {
    const idempotencyKey = ctx.req.header("Idempotency-Key");
    const methodSupportsIdempotency = ctx.req.method === "POST";
    if (!methodSupportsIdempotency || idempotencyKey === undefined) {
      return next();
    }

    const idempotencyKeyIsInvalid = idempotencyKey.length === 0 || idempotencyKey.length > 255;
    if (idempotencyKeyIsInvalid) {
      return toHttpResponse(
        err({
          code: codes.validationError,
          message: "Provide an Idempotency-Key header containing between 1 and 255 characters.",
          details: [
            {
              code: "invalid_idempotency_key",
              field: "Idempotency-Key",
              message: "Use 1 to 255 characters.",
            },
          ],
        }),
      );
    }

    const { cache, claims, logger } = ctx.var;

    const key = `idempotency:${createHash("sha256")
      .update(JSON.stringify([claims.sub, idempotencyKey]))
      .digest("hex")}`;

    const fingerprint = await requestFingerprint(ctx);
    const owner = randomUUID();
    const claim = await REDIS_FALLBACK_POLICY.execute(async () =>
      ClaimResult.parse(await cache.eval(CLAIM_SCRIPT, 1, key, fingerprint, owner, IDEMPOTENCY_WINDOW_SECONDS)),
    );

    const claimIsInvalid = claim?.[0] === "invalid";
    if (claim === null || claimIsInvalid) {
      logger.error({ key }, "Idempotency claim unavailable");
      return toHttpResponse(
        err({
          code: codes.idempotencyUnavailable,
          message: "Duplicate protection is temporarily unavailable. Retry this request with the same idempotency key.",
          details: [],
        }),
      );
    }

    const claimAlreadyExists = claim[0] === "existing";
    const requestDoesNotMatch = claimAlreadyExists && claim[1] !== fingerprint;
    if (requestDoesNotMatch) {
      return toHttpResponse(
        err({
          code: codes.idempotencyKeyMismatch,
          message: "This idempotency key was used for a different request. Use the original request or a new key.",
          details: [],
        }),
      );
    }

    const requestIsUnfinished = claimAlreadyExists && claim[2] === "";
    if (requestIsUnfinished) {
      return toHttpResponse(
        err({
          code: codes.idempotencyRequestInProgress,
          message: "A request with this idempotency key is unfinished. Retry with the same key or check its result.",
          details: [],
        }),
      );
    }

    if (claimAlreadyExists) {
      const response = await REDIS_FALLBACK_POLICY.execute(() => {
        const saved = CachedResponse.parse(JSON.parse(claim[2]));
        const responseHasNoBody = [204, 205, 304].includes(saved.status);
        const body = responseHasNoBody ? null : Uint8Array.from(Buffer.from(saved.body, "base64"));
        return ctx.newResponse(body, { status: saved.status as StatusCode, headers: saved.headers });
      });

      if (response === null) {
        logger.error({ key }, "Saved idempotency response is invalid");
        return toHttpResponse(
          err({
            code: codes.idempotencyUnavailable,
            message:
              "Duplicate protection is temporarily unavailable. Retry this request with the same idempotency key.",
            details: [],
          }),
        );
      }

      return response;
    }

    await next();

    const finalized = await REDIS_FALLBACK_POLICY.execute(async () => {
      const body = Buffer.from(await ctx.res.clone().arrayBuffer());
      const responseIsBadRequest = ctx.res.status === 400;
      const responseIsJson = ctx.res.headers.get("Content-Type")?.startsWith("application/json") === true;
      const responseMayContainValidationError = responseIsBadRequest && responseIsJson;
      const payload: unknown = responseMayContainValidationError ? JSON.parse(body.toString("utf8")) : null;

      if (payload !== null) {
        const payloadIsObject = typeof payload === "object";
        const payloadHasErrorCode = payloadIsObject && "code" in payload;
        const responseIsValidationError = payloadHasErrorCode && payload.code === codes.validationError;
        if (responseIsValidationError) {
          return cache.eval(COMPLETE_SCRIPT, 1, key, owner, "");
        }
      }

      const response = {
        status: ctx.res.status,
        body: body.toString("base64"),
        headers: Array.from(ctx.res.headers.entries()).filter(([name]) => {
          const headerShouldBeReplayed = REPLAY_HEADERS.includes(name);
          return headerShouldBeReplayed;
        }),
      };
      return cache.eval(COMPLETE_SCRIPT, 1, key, owner, JSON.stringify(response));
    });

    const recordWasFinalized = finalized === 1;
    if (!recordWasFinalized) {
      logger.error({ key }, "Idempotency record could not be finalized");
    }
  });
}

export { idempotency };
