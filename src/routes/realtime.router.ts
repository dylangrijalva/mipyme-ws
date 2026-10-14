import { validator } from "hono/validator";
import { AuthorizeChannelRequest } from "../integrations/realtime-event-publisher.ts";
import { membershipGuard } from "../guards/membership-guard.ts";
import { AuthorizeRealtimeChannelService } from "../services/authorize-realtime-channel-service.ts";
import { authorize } from "../middlewares/authorize.ts";
import { createAuthScopedKey, rateLimiter } from "../middlewares/rate-limiter.ts";
import { FacilitoHono } from "../types.ts";
import { camelCaseKeys } from "../utils/camel-case-keys.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function realtimeRouter(): FacilitoHono {
  const router = new FacilitoHono();

  router.use(
    "*",
    authorize(),
    membershipGuard(),
    rateLimiter({
      key: createAuthScopedKey,
      limit: 240,
      windowInSeconds: 60,
    }),
  );

  router.post(
    "/subscriptions",
    validator("form", (input) => AuthorizeChannelRequest.parse(camelCaseKeys({ ...input }))),
    async (ctx) => {
      const request = ctx.req.valid("form");
      const service = AuthorizeRealtimeChannelService.create(ctx.var);
      const result = await service.execute(request);
      return toHttpResponse(result);
    },
  );

  return router;
}

export { realtimeRouter };
