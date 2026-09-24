import { Scalar } from "@scalar/hono-api-reference";
import { contextStorage } from "hono/context-storage";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";
import { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Database } from "./db/index.ts";
import { devGuard } from "./guards/dev-guard.ts";
import type { EnvVars } from "./infra/config.env.ts";
import { camelCase } from "./middlewares/camel-case.ts";
import { errorHandler } from "./middlewares/error-handler.ts";
import { inject } from "./middlewares/inject.ts";
import { logging } from "./middlewares/logging.ts";
import { notFoundHandler } from "./middlewares/not-found-handler.ts";
import { requestId } from "./middlewares/request-id.ts";
import { snakeCase } from "./middlewares/snake-case.ts";
import OpenAPIDocument from "./openapi.json" with { type: "json" };
import { FacilitoHono } from "./types.ts";

type InjectedDependencies = {
  logger: Logger;
  env: EnvVars;
  db: Database;
  cache: Redis;
};

function createApp(dependencies: InjectedDependencies): FacilitoHono {
  const app = new FacilitoHono();

  app.use("/v1/*", ...[snakeCase(), camelCase()]);

  app.use(inject(dependencies));
  app.use(contextStorage());
  app.use(requestId());
  app.use(logging());
  app.use(secureHeaders());
  app.use(prettyJSON());

  app.notFound(notFoundHandler());
  app.onError(errorHandler());

  app.get("/_health", devGuard(), async (ctx) => {
    const { db, cache } = ctx.var;

    await db.execute("SELECT 1;");
    await cache.ping();

    return ctx.body(null, 204);
  });

  app.get("/openapi.json", devGuard(), (ctx) => {
    return ctx.json(OpenAPIDocument);
  });

  app.get(
    "/scalar",
    devGuard(),
    Scalar({
      pageTitle: "Facilito API Reference",
      url: "/openapi.json",
      theme: "alternate",
    }),
  );

  return app;
}

export { createApp, type InjectedDependencies };
