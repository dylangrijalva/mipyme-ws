import { validator } from "hono/validator";
import { membershipGuard } from "../guards/membership-guard.ts";
import { authorize } from "../middlewares/authorize.ts";
import { CreateSaleRequest, CreateSaleService } from "../services/sales/create-sale-service.ts";
import { VoidSaleRequest, VoidSaleService } from "../services/sales/void-sale-service.ts";
import { FacilitoHono } from "../types.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function salesRouter(): FacilitoHono {
  const router = new FacilitoHono();

  router.use(authorize(), membershipGuard());

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
