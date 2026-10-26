import { validator } from "hono/validator";
import { ObjectId } from "../contracts/object-id.ts";
import { PaginationRequest } from "../contracts/pagination-query.ts";
import { membershipGuard } from "../guards/membership-guard.ts";
import { authorize } from "../middlewares/authorize.ts";
import { idempotency } from "../middlewares/idempotency.ts";
import { createAuthScopedKey, DEFAULT_RATE_LIMIT_CONFIG, rateLimiter } from "../middlewares/rate-limiter.ts";
import { CreateSupplierRequest, CreateSupplierService } from "../services/suppliers/create-supplier-service.ts";
import { FindSupplierService } from "../services/suppliers/find-supplier-service.ts";
import { ListSuppliersService } from "../services/suppliers/list-suppliers-service.ts";
import { UpdateSupplierRequest, UpdateSupplierService } from "../services/suppliers/update-supplier-service.ts";
import { MipymeHono } from "../types.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function suppliersRouter(): MipymeHono {
  const router = new MipymeHono();

  router.use(authorize(), rateLimiter({ key: createAuthScopedKey, ...DEFAULT_RATE_LIMIT_CONFIG }), membershipGuard());

  router.post(
    "/",
    validator("json", (input) => CreateSupplierRequest.parse(input)),
    idempotency(),
    async (ctx) => {
      const request = ctx.req.valid("json");
      const service = CreateSupplierService.create(ctx.var);
      const result = await service.execute(request);
      return toHttpResponse(result, 201);
    },
  );

  router.patch(
    "/:id",
    validator("param", (input) => ObjectId.parse(input.id)),
    validator("json", (input) => UpdateSupplierRequest.parse(input)),
    async (ctx) => {
      const id = ctx.req.valid("param");
      const request = ctx.req.valid("json");
      const service = UpdateSupplierService.create(ctx.var);
      const result = await service.execute([id, request]);
      return toHttpResponse(result);
    },
  );

  router.get(
    "/:id",
    validator("param", (input) => ObjectId.parse(input.id)),
    async (ctx) => {
      const id = ctx.req.valid("param");
      const service = FindSupplierService.create(ctx.var);
      const result = await service.execute(id);
      return toHttpResponse(result);
    },
  );

  router.get(
    "/",
    validator("query", (input) => PaginationRequest.parse(input)),
    async (ctx) => {
      const query = ctx.req.valid("query");
      const service = ListSuppliersService.create(ctx.var);
      const result = await service.execute(query);
      return toHttpResponse(result);
    },
  );

  return router;
}

export { suppliersRouter };
