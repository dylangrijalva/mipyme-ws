import { validator } from "hono/validator";
import { ObjectId } from "../contracts/object-id.ts";
import { PaginationRequest } from "../contracts/pagination-query.ts";
import { membershipGuard } from "../guards/membership-guard.ts";
import { authorize } from "../middlewares/authorize.ts";
import { CreateProductRequest, CreateProductService } from "../services/catalog/products/create-product-service.ts";
import { FindProductService } from "../services/catalog/products/find-product-service.ts";
import { ListProductsService } from "../services/catalog/products/list-product-service.ts";
import { UpdateProductRequest, UpdateProductService } from "../services/catalog/products/update-product-service.ts";
import { FacilitoHono } from "../types.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function productsRouter(): FacilitoHono {
  const router = new FacilitoHono();

  router.use(authorize(), membershipGuard());

  router.post(
    "/",
    validator("json", (input) => CreateProductRequest.parse(input)),
    async (ctx) => {
      const request = ctx.req.valid("json");
      const service = CreateProductService.create(ctx.var);
      const result = await service.execute(request);
      return toHttpResponse(result, 201);
    },
  );

  router.patch(
    "/:id",
    validator("param", (input) => ObjectId.parse(input.id)),
    validator("json", (input) => UpdateProductRequest.parse(input)),
    async (ctx) => {
      const id = ctx.req.valid("param");
      const request = ctx.req.valid("json");
      const service = UpdateProductService.create(ctx.var);
      const result = await service.execute([id, request]);
      return toHttpResponse(result);
    },
  );

  router.get(
    "/:id",
    validator("param", (input) => ObjectId.parse(input.id)),
    async (ctx) => {
      const id = ctx.req.valid("param");
      const service = FindProductService.create(ctx.var);
      const result = await service.execute(id);
      return toHttpResponse(result);
    },
  );

  router.get(
    "/",
    validator("query", (input) => PaginationRequest.parse(input)),
    async (ctx) => {
      const query = ctx.req.valid("query");
      const service = ListProductsService.create(ctx.var);
      const result = await service.execute(query);
      return toHttpResponse(result);
    },
  );

  return router;
}

export { productsRouter };
