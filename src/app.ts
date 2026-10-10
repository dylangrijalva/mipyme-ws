import { Scalar } from "@scalar/hono-api-reference";
import { contextStorage } from "hono/context-storage";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";
import { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Database } from "./db/index.ts";
import type { CollectionFinder } from "./finders/collection-finder.ts";
import type { CustomerFinder } from "./finders/customer-finder.ts";
import type { MerchantFinder } from "./finders/merchant-finder.ts";
import type { ProductFinder } from "./finders/product-finder.ts";
import type { PurchaseFinder } from "./finders/purchase-finder.ts";
import type { SupplierFinder } from "./finders/supplier-finder.ts";
import { devGuard } from "./guards/dev-guard.ts";
import type { EnvVars } from "./infra/config.env.ts";
import type { IdentityProvider } from "./integrations/identity-provider.ts";
import { authorize } from "./middlewares/authorize.ts";
import { camelCase } from "./middlewares/camel-case.ts";
import { errorHandler } from "./middlewares/error-handler.ts";
import { inject } from "./middlewares/inject.ts";
import { logging } from "./middlewares/logging.ts";
import { notFoundHandler } from "./middlewares/not-found-handler.ts";
import { requestId } from "./middlewares/request-id.ts";
import { snakeCase } from "./middlewares/snake-case.ts";
import OpenAPIDocument from "./openapi.json" with { type: "json" };
import { collectionsRouter } from "./routes/collections.router.ts";
import { customersRouter } from "./routes/customers.router.ts";
import { onboardingRouter } from "./routes/onboarding.router.ts";
import { productsRouter } from "./routes/products.router.ts";
import { salesRouter } from "./routes/sales.router.ts";
import { suppliersRouter } from "./routes/suppliers.router.ts";
import { FacilitoHono } from "./types.ts";

type InjectedDependencies = {
  logger: Logger;
  env: EnvVars;
  db: Database;
  cache: Redis;
  identity: IdentityProvider;
  merchantFinder: MerchantFinder;
  collectionFinder: CollectionFinder;
  customerFinder: CustomerFinder;
  supplierFinder: SupplierFinder;
  productFinder: ProductFinder;
  purchaseFinder: PurchaseFinder;
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

  app.route("/v1/onboarding", onboardingRouter());
  app.route("/v1/products", productsRouter());
  app.route("/v1/collections", collectionsRouter());
  app.route("/v1/customers", customersRouter());
  app.route("/v1/suppliers", suppliersRouter());
  app.route("/v1/sales", salesRouter());

  app.get("/_health", async (ctx) => {
    const { db, cache } = ctx.var;
    await db.execute("SELECT 1;");
    await cache.ping();
    return ctx.body(null, 204);
  });

  app.get("/me", authorize(), async (ctx) => {
    return ctx.json(ctx.var.claims);
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
