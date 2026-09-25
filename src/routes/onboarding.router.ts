import { validator } from "hono/validator";
import { OnboardAccountRequest, ProvisionAccountService } from "../services/onboarding/provision-account-service.ts";
import { FacilitoHono } from "../types.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function onboardingRouter(): FacilitoHono {
  const router = new FacilitoHono();

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
