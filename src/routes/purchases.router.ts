import { validator } from "hono/validator";
import { ObjectId } from "../contracts/object-id.ts";
import { PurchasePaginationRequest } from "../contracts/purchase-pagination-query.ts";
import { membershipGuard } from "../guards/membership-guard.ts";
import { authorize } from "../middlewares/authorize.ts";
import { createAuthScopedKey, DEFAULT_RATE_LIMIT_CONFIG, rateLimiter } from "../middlewares/rate-limiter.ts";
import { FindPurchaseService } from "../services/purchases/find-purchase-service.ts";
import { ListPurchasesService } from "../services/purchases/list-purchases-service.ts";
import { FacilitoHono } from "../types.ts";
import { camelCaseKeys } from "../utils/camel-case-keys.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function purchasesRouter(): FacilitoHono {
  const router = new FacilitoHono();

  router.use(authorize(), rateLimiter({ key: createAuthScopedKey, ...DEFAULT_RATE_LIMIT_CONFIG }), membershipGuard());

  router.get(
    "/:id",
    validator("param", (input) => ObjectId.parse(input.id)),
    async (ctx) => {
      const service = FindPurchaseService.create(ctx.var);
      return toHttpResponse(await service.execute(ctx.req.valid("param")));
    },
  );

  router.get(
    "/",
    validator("query", (input) => PurchasePaginationRequest.parse(camelCaseKeys(input))),
    async (ctx) => {
      const service = ListPurchasesService.create(ctx.var);
      return toHttpResponse(await service.execute(ctx.req.valid("query")));
    },
  );

  return router;
}

export { purchasesRouter };
