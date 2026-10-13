import { validator } from "hono/validator";
import { authorize } from "../middlewares/authorize.ts";
import { createAuthOperationScopedKey, DEFAULT_RATE_LIMIT_CONFIG, rateLimiter } from "../middlewares/rate-limiter.ts";
import { OnboardAccountRequest, ProvisionAccountService } from "../services/onboarding/provision-account-service.ts";
import { FacilitoHono } from "../types.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function onboardingRouter(): FacilitoHono {
  const router = new FacilitoHono();

  router.use(
    authorize(),
    rateLimiter({ key: createAuthOperationScopedKey("onboarding"), ...DEFAULT_RATE_LIMIT_CONFIG }),
  );

  router.post(
    "/",
    validator("json", (payload) => OnboardAccountRequest.parse(payload)),
    async (ctx) => {
      const request = ctx.req.valid("json");
      const service = ProvisionAccountService.create(ctx.var);
      const result = await service.execute(request);
      return toHttpResponse(result);
    },
  );

  return router;
}

export { onboardingRouter };
