import { validator } from "hono/validator";
import { ObjectId } from "../contracts/object-id.ts";
import { PaginationRequest } from "../contracts/pagination-query.ts";
import { membershipGuard } from "../guards/membership-guard.ts";
import { authorize } from "../middlewares/authorize.ts";
import { idempotency } from "../middlewares/idempotency.ts";
import { createAuthScopedKey, DEFAULT_RATE_LIMIT_CONFIG, rateLimiter } from "../middlewares/rate-limiter.ts";
import { CreateLocationRequest, CreateLocationService } from "../services/locations/create-location-service.ts";
import { FindLocationService } from "../services/locations/find-location-service.ts";
import { ListLocationsService } from "../services/locations/list-locations-service.ts";
import { UpdateLocationRequest, UpdateLocationService } from "../services/locations/update-location-service.ts";
import { FacilitoHono } from "../types.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function locationsRouter(): FacilitoHono {
  const router = new FacilitoHono();

  router.use(
    authorize(),
    rateLimiter({
      key: createAuthScopedKey,
      ...DEFAULT_RATE_LIMIT_CONFIG,
    }),
    membershipGuard(),
  );

  router.post(
    "/",
    validator("json", (input) => CreateLocationRequest.parse(input)),
    idempotency(),
    async (ctx) => {
      const request = ctx.req.valid("json");
      const service = CreateLocationService.create(ctx.var);
      const result = await service.execute(request);
      return toHttpResponse(result, 201);
    },
  );

  router.patch(
    "/:id",
    validator("param", (input) => ObjectId.parse(input.id)),
    validator("json", (input) => UpdateLocationRequest.parse(input)),
    async (ctx) => {
      const id = ctx.req.valid("param");
      const request = ctx.req.valid("json");
      const service = UpdateLocationService.create(ctx.var);
      const result = await service.execute([id, request]);
      return toHttpResponse(result);
    },
  );

  router.get(
    "/:id",
    validator("param", (input) => ObjectId.parse(input.id)),
    async (ctx) => {
      const id = ctx.req.valid("param");
      const service = FindLocationService.create(ctx.var);
      const result = await service.execute(id);
      return toHttpResponse(result);
    },
  );

  router.get(
    "/",
    validator("query", (input) => PaginationRequest.parse(input)),
    async (ctx) => {
      const query = ctx.req.valid("query");
      const service = ListLocationsService.create(ctx.var);
      const result = await service.execute(query);
      return toHttpResponse(result);
    },
  );

  return router;
}

export { locationsRouter };
