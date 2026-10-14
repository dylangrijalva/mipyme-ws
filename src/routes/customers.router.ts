import { validator } from "hono/validator";
import { ObjectId } from "../contracts/object-id.ts";
import { PaginationRequest } from "../contracts/pagination-query.ts";
import { membershipGuard } from "../guards/membership-guard.ts";
import { authorize } from "../middlewares/authorize.ts";
import { idempotency } from "../middlewares/idempotency.ts";
import { createAuthScopedKey, DEFAULT_RATE_LIMIT_CONFIG, rateLimiter } from "../middlewares/rate-limiter.ts";
import { CreateCustomerRequest, CreateCustomerService } from "../services/customers/create-customer-service.ts";
import { FindCustomerService } from "../services/customers/find-customer-service.ts";
import { ListCustomersService } from "../services/customers/list-customers-service.ts";
import { UpdateCustomerRequest, UpdateCustomerService } from "../services/customers/update-customer-service.ts";
import { FacilitoHono } from "../types.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function customersRouter(): FacilitoHono {
  const router = new FacilitoHono();

  router.use(authorize(), rateLimiter({ key: createAuthScopedKey, ...DEFAULT_RATE_LIMIT_CONFIG }), membershipGuard());

  router.post(
    "/",
    validator("json", (input) => CreateCustomerRequest.parse(input)),
    idempotency(),
    async (ctx) => {
      const request = ctx.req.valid("json");
      const service = CreateCustomerService.create(ctx.var);
      const result = await service.execute(request);
      return toHttpResponse(result, 201);
    },
  );

  router.patch(
    "/:id",
    validator("param", (input) => ObjectId.parse(input.id)),
    validator("json", (input) => UpdateCustomerRequest.parse(input)),
    async (ctx) => {
      const id = ctx.req.valid("param");
      const request = ctx.req.valid("json");
      const service = UpdateCustomerService.create(ctx.var);
      const result = await service.execute([id, request]);
      return toHttpResponse(result);
    },
  );

  router.get(
    "/:id",
    validator("param", (input) => ObjectId.parse(input.id)),
    async (ctx) => {
      const id = ctx.req.valid("param");
      const service = FindCustomerService.create(ctx.var);
      const result = await service.execute(id);
      return toHttpResponse(result);
    },
  );

  router.get(
    "/",
    validator("query", (input) => PaginationRequest.parse(input)),
    async (ctx) => {
      const query = ctx.req.valid("query");
      const service = ListCustomersService.create(ctx.var);
      const result = await service.execute(query);
      return toHttpResponse(result);
    },
  );

  return router;
}

export { customersRouter };
