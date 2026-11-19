import { Scalar } from "@scalar/hono-api-reference";
import { contextStorage } from "hono/context-storage";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";
import { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Database } from "./db/index.ts";
import type { CollectionFinder } from "./finders/collection-finder.ts";
import type { CustomerFinder } from "./finders/customer-finder.ts";
import type { EmployeeFinder } from "./finders/employee-finder.ts";
import type { InvitationFinder } from "./finders/invitation-finder.ts";
import type { LocationFinder } from "./finders/location-finder.ts";
import type { MerchantFinder } from "./finders/merchant-finder.ts";
import type { ProductFinder } from "./finders/product-finder.ts";
import type { PurchaseFinder } from "./finders/purchase-finder.ts";
import type { SaleFinder } from "./finders/sale-finder.ts";
import type { SupplierFinder } from "./finders/supplier-finder.ts";
import { devGuard } from "./guards/dev-guard.ts";
import type { EnvVars } from "./infra/config.env.ts";
import type { EmailSender } from "./integrations/email-sender.ts";
import type { IdentityProvider } from "./integrations/identity-provider.ts";
import type { ProductImageStore } from "./integrations/product-image-store.ts";
import type { RealtimeEventPublisher } from "./integrations/realtime-event-publisher.ts";
import { authorize } from "./middlewares/authorize.ts";
import { camelCase } from "./middlewares/camel-case.ts";
import { errorHandler } from "./middlewares/error-handler.ts";
import { inject } from "./middlewares/inject.ts";
import { logging } from "./middlewares/logging.ts";
import { notFoundHandler } from "./middlewares/not-found-handler.ts";
import {
  createAuthScopedKey,
  createPublicScopedKey,
  DEFAULT_RATE_LIMIT_CONFIG,
  rateLimiter,
} from "./middlewares/rate-limiter.ts";
import { requestId } from "./middlewares/request-id.ts";
import { snakeCase } from "./middlewares/snake-case.ts";
import OpenAPIDocument from "./openapi.json" with { type: "json" };
import { collectionsRouter } from "./routes/collections.router.ts";
import { customersRouter } from "./routes/customers.router.ts";
import { employeesRouter } from "./routes/employees.router.ts";
import { invitationsRouter } from "./routes/invitations.router.ts";
import { locationsRouter } from "./routes/locations.router.ts";
import { onboardingRouter } from "./routes/onboarding.router.ts";
import { productsRouter } from "./routes/products.router.ts";
import { purchasesRouter } from "./routes/purchases.router.ts";
import { realtimeRouter } from "./routes/realtime.router.ts";
import { salesRouter } from "./routes/sales.router.ts";
import { suppliersRouter } from "./routes/suppliers.router.ts";
import { syncRouter } from "./routes/sync.router.ts";
import type { EmployeeManagement } from "./services/employee-management.ts";
import { MipymeHono } from "./types.ts";

type InjectedDependencies = {
  logger: Logger;
  env: EnvVars;
  db: Database;
  cache: Redis;
  identity: IdentityProvider;
  emailSender: EmailSender;
  employeeManagement: EmployeeManagement;
  productImageStore: ProductImageStore;
  publisher: RealtimeEventPublisher;
  merchantFinder: MerchantFinder;
  collectionFinder: CollectionFinder;
  customerFinder: CustomerFinder;
  employeeFinder: EmployeeFinder;
  invitationFinder: InvitationFinder;
  locationFinder: LocationFinder;
  supplierFinder: SupplierFinder;
  productFinder: ProductFinder;
  purchaseFinder: PurchaseFinder;
  saleFinder: SaleFinder;
};

function createApp(dependencies: InjectedDependencies): MipymeHono {
  const app = new MipymeHono();

  app.use(inject(dependencies));
  app.use(contextStorage());
  app.use(requestId());
  app.use(logging());
  app.use(secureHeaders());
  app.use(prettyJSON());

  app.use("/v1/*", ...[snakeCase(), camelCase()]);

  app.notFound(notFoundHandler());
  app.onError(errorHandler());

  app.route("/v1/onboarding", onboardingRouter());
  app.route("/v1/products", productsRouter());
  app.route("/v1/collections", collectionsRouter());
  app.route("/v1/customers", customersRouter());
  app.route("/v1/locations", locationsRouter());
  app.route("/v1/employees", employeesRouter());
  app.route("/v1/invitations", invitationsRouter());
  app.route("/v1/suppliers", suppliersRouter());
  app.route("/v1/sales", salesRouter());
  app.route("/v1/purchases", purchasesRouter());
  app.route("/v1/realtime", realtimeRouter());
  app.route("/v1/sync", syncRouter());

  app.get("/_health", rateLimiter({ key: createPublicScopedKey, ...DEFAULT_RATE_LIMIT_CONFIG }), async (ctx) => {
    const { db, cache } = ctx.var;
    await db.execute("SELECT 1;");
    await cache.ping();
    return ctx.body(null, 204);
  });

  app.get(
    "/me",
    snakeCase(),
    authorize(),
    rateLimiter({ key: createAuthScopedKey, ...DEFAULT_RATE_LIMIT_CONFIG }),
    async (ctx) => {
      return ctx.json(ctx.var.claims);
    },
  );

  app.get("/openapi.json", devGuard(), (ctx) => {
    return ctx.json(OpenAPIDocument);
  });

  app.get(
    "/scalar",
    devGuard(),
    Scalar({
      pageTitle: "Mipyme API Reference",
      url: "/openapi.json",
      theme: "alternate",
    }),
  );

  return app;
}

export { createApp, type InjectedDependencies };
