import { createMiddleware } from "hono/factory";
import { codes } from "../contracts/business-error.ts";
import type { MipymeEnv } from "../types.ts";
import { err } from "../utils/result.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function authorize() {
  return createMiddleware<MipymeEnv>(async (ctx, next) => {
    const token = ctx.req.header("Authorization")?.match(/^Bearer +([A-Za-z0-9._~+/-]+=*)$/i)?.[1];

    if (!token) {
      return toHttpResponse(
        err({
          code: codes.invalidOAuthToken,
          message: "Provide a bearer token in the Authorization header.",
          details: [],
        }),
      );
    }

    const { identity } = ctx.var;
    const result = await identity.verifyToken(token);

    if (!result.success) {
      return toHttpResponse(result);
    }

    ctx.set("claims", result.value);
    return next();
  });
}

export { authorize };
