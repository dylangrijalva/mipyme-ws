import { validator } from "hono/validator";
import { ObjectId } from "../contracts/object-id.ts";
import { SalePaginationRequest } from "../contracts/sale-pagination-query.ts";
import { membershipGuard } from "../guards/membership-guard.ts";
import { authorize } from "../middlewares/authorize.ts";
import { CreateSaleRequest, CreateSaleService } from "../services/sales/create-sale-service.ts";
import { FindSaleService } from "../services/sales/find-sale-service.ts";
import { ListSalesService } from "../services/sales/list-sale-service.ts";
import { VoidSaleRequest, VoidSaleService } from "../services/sales/void-sale-service.ts";
import { FacilitoHono } from "../types.ts";
import { camelCaseKeys } from "../utils/camel-case-keys.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function salesRouter(): FacilitoHono {
  const router = new FacilitoHono();

  router.use(authorize(), membershipGuard());

  router.get(
    "/:id",
    validator("param", (input) => ObjectId.parse(input.id)),
    async (ctx) => {
      const service = FindSaleService.create(ctx.var);
      return toHttpResponse(await service.execute(ctx.req.valid("param")));
    },
  );

  router.get(
    "/",
    validator("query", (input) => SalePaginationRequest.parse(camelCaseKeys(input))),
    async (ctx) => {
      const service = ListSalesService.create(ctx.var);
      return toHttpResponse(await service.execute(ctx.req.valid("query")));
    },
  );

  router.post(
    "/",
    validator("json", (input) => CreateSaleRequest.parse(input)),
    async (ctx) => {
      const request = ctx.req.valid("json");
      const service = CreateSaleService.create(ctx.var);
      const result = await service.execute(request);
      return toHttpResponse(result, 201);
    },
  );

  router.post(
    "/:id/void",
    validator("json", (input) => VoidSaleRequest.parse(input)),
    async (ctx) => {
      const id = ctx.req.param("id");
      const request = ctx.req.valid("json");
      const service = VoidSaleService.create(ctx.var);
      const result = await service.execute(id, request);
      return toHttpResponse(result);
    },
  );

  return router;
}

export { salesRouter };
