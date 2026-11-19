import { validator } from "hono/validator";
import { InventoryChangePaginationRequest } from "../contracts/inventory-change-pagination-query.ts";
import { membershipGuard } from "../guards/membership-guard.ts";
import { authorize } from "../middlewares/authorize.ts";
import { idempotency } from "../middlewares/idempotency.ts";
import { createAuthScopedKey, DEFAULT_RATE_LIMIT_CONFIG, rateLimiter } from "../middlewares/rate-limiter.ts";
import {
  CreateInventoryAdjustmentsRequest,
  CreateInventoryAdjustmentsService,
} from "../services/inventory/create-inventory-adjustments-service.ts";
import { ListInventoryChangesService } from "../services/inventory/list-inventory-changes-service.ts";
import { MipymeHono } from "../types.ts";
import { camelCaseKeys } from "../utils/camel-case-keys.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function inventoryRouter(): MipymeHono {
  const router = new MipymeHono();

  router.use(authorize(), rateLimiter({ key: createAuthScopedKey, ...DEFAULT_RATE_LIMIT_CONFIG }), membershipGuard());

  router.post(
    "/adjustments",
    validator("json", (input) => CreateInventoryAdjustmentsRequest.parse(input)),
    idempotency(),
    async (ctx) => {
      const service = CreateInventoryAdjustmentsService.create(ctx.var);
      return toHttpResponse(await service.execute(ctx.req.valid("json")), 201);
    },
  );

  router.get(
    "/changes",
    validator("query", (input) => InventoryChangePaginationRequest.parse(camelCaseKeys(input))),
    async (ctx) => {
      const service = ListInventoryChangesService.create(ctx.var);
      return toHttpResponse(await service.execute(ctx.req.valid("query")));
    },
  );

  return router;
}

export { inventoryRouter };
