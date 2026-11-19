import { validator } from "hono/validator";
import { ObjectId } from "../contracts/object-id.ts";
import { authorize } from "../middlewares/authorize.ts";
import { idempotency } from "../middlewares/idempotency.ts";
import { createAuthScopedKey, DEFAULT_RATE_LIMIT_CONFIG, rateLimiter } from "../middlewares/rate-limiter.ts";
import { AcceptInvitationService } from "../services/staff/invitations/accept-invitation-service.ts";
import { ListReceivedInvitationsService } from "../services/staff/invitations/list-received-invitations-service.ts";
import { MipymeHono } from "../types.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function invitationsRouter(): MipymeHono {
  const router = new MipymeHono();

  router.use(authorize(), rateLimiter({ key: createAuthScopedKey, ...DEFAULT_RATE_LIMIT_CONFIG }));

  router.get("/", async (ctx) => {
    const service = ListReceivedInvitationsService.create(ctx.var);
    const result = await service.execute();
    return toHttpResponse(result);
  });

  router.post(
    "/:id/accept",
    validator("param", (input) => ObjectId.parse(input.id)),
    idempotency(),
    async (ctx) => {
      const service = AcceptInvitationService.create(ctx.var);
      const result = await service.execute(ctx.req.valid("param"));
      return toHttpResponse(result);
    },
  );

  return router;
}

export { invitationsRouter };
