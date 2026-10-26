import { validator } from "hono/validator";
import { ObjectId } from "../contracts/object-id.ts";
import { PurchasePaginationRequest } from "../contracts/purchase-pagination-query.ts";
import { membershipGuard } from "../guards/membership-guard.ts";
import { authorize } from "../middlewares/authorize.ts";
import { idempotency } from "../middlewares/idempotency.ts";
import { createAuthScopedKey, DEFAULT_RATE_LIMIT_CONFIG, rateLimiter } from "../middlewares/rate-limiter.ts";
import { CreatePurchaseRequest, CreatePurchaseService } from "../services/purchases/create-purchase-service.ts";
import { FindPurchaseService } from "../services/purchases/find-purchase-service.ts";
import { ListPurchasesService } from "../services/purchases/list-purchases-service.ts";
import { VoidPurchaseRequest, VoidPurchaseService } from "../services/purchases/void-purchase-service.ts";
import { MipymeHono } from "../types.ts";
import { camelCaseKeys } from "../utils/camel-case-keys.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function purchasesRouter(): MipymeHono {
  const router = new MipymeHono();

  router.use(authorize(), rateLimiter({ key: createAuthScopedKey, ...DEFAULT_RATE_LIMIT_CONFIG }), membershipGuard());

  router.post(
    "/",
    validator("json", (input) => CreatePurchaseRequest.parse(input)),
    idempotency(),
    async (ctx) => {
      const request = ctx.req.valid("json");
      const service = CreatePurchaseService.create(ctx.var);
      const result = await service.execute(request);
      return toHttpResponse(result, 201);
    },
  );

  router.post(
    "/:id/void",
    validator("param", (input) => ObjectId.parse(input.id)),
    validator("json", (input) => VoidPurchaseRequest.parse(input)),
    idempotency(),
    async (ctx) => {
      const service = VoidPurchaseService.create(ctx.var);
      return toHttpResponse(await service.execute(ctx.req.valid("param"), ctx.req.valid("json")));
    },
  );

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
