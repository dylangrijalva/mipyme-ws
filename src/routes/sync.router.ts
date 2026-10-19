import { validator } from "hono/validator";
import { SyncRequest } from "../contracts/sync.ts";
import { membershipGuard } from "../guards/membership-guard.ts";
import { authorize } from "../middlewares/authorize.ts";
import { IncrementalSyncService } from "../services/sync/incremental-sync-service.ts";
import { FacilitoHono } from "../types.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function syncRouter(): FacilitoHono {
  const router = new FacilitoHono();

  router.use(authorize(), membershipGuard());

  router.post(
    "/",
    validator("json", (input) => SyncRequest.parse(input)),
    async (ctx) => {
      ctx.header("Cache-Control", "no-store");
      const request = ctx.req.valid("json");
      const result = await IncrementalSyncService.create(ctx.var).execute(request);
      return toHttpResponse(result);
    },
  );
  return router;
}

export { syncRouter };
