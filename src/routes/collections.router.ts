import { validator } from "hono/validator";
import { ObjectId } from "../contracts/object-id.ts";
import { PaginationRequest } from "../contracts/pagination-query.ts";
import { membershipGuard } from "../guards/membership-guard.ts";
import { authorize } from "../middlewares/authorize.ts";
import { CreateCollectionRequest, CreateCollectionService } from "../services/collections/create-collection-service.ts";
import { FindCollectionService } from "../services/collections/find-collection-service.ts";
import { ListCollectionsService } from "../services/collections/list-collections-service.ts";
import { UpdateCollectionRequest, UpdateCollectionService } from "../services/collections/update-collection-service.ts";
import { FacilitoHono } from "../types.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function collectionsRouter(): FacilitoHono {
  const router = new FacilitoHono();

  router.use(authorize(), membershipGuard());

  router.post(
    "/",
    validator("json", (input) => CreateCollectionRequest.parse(input)),
    async (ctx) => {
      const request = ctx.req.valid("json");
      const service = CreateCollectionService.create(ctx.var);
      const result = await service.execute(request);
      return toHttpResponse(result, 201);
    },
  );

  router.patch(
    "/:id",
    validator("param", (input) => ObjectId.parse(input.id)),
    validator("json", (input) => UpdateCollectionRequest.parse(input)),
    async (ctx) => {
      const id = ctx.req.valid("param");
      const request = ctx.req.valid("json");
      const service = UpdateCollectionService.create(ctx.var);
      const result = await service.execute([id, request]);
      return toHttpResponse(result);
    },
  );

  router.get(
    "/:id",
    validator("param", (input) => ObjectId.parse(input.id)),
    async (ctx) => {
      const id = ctx.req.valid("param");
      const service = FindCollectionService.create(ctx.var);
      const result = await service.execute(id);
      return toHttpResponse(result);
    },
  );

  router.get(
    "/",
    validator("query", (input) => PaginationRequest.parse(input)),
    async (ctx) => {
      const query = ctx.req.valid("query");
      const service = ListCollectionsService.create(ctx.var);
      const result = await service.execute(query);
      return toHttpResponse(result);
    },
  );

  return router;
}

export { collectionsRouter };
