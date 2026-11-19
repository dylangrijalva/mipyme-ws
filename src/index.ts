import { serve } from "@hono/node-server";
import chalk from "chalk";
import { Redis } from "ioredis";
import { createApp } from "./app.ts";
import { createDrizzle } from "./db/index.ts";
import { CollectionFinder } from "./finders/collection-finder.ts";
import { CustomerFinder } from "./finders/customer-finder.ts";
import { EmployeeFinder } from "./finders/employee-finder.ts";
import { InvitationFinder } from "./finders/invitation-finder.ts";
import { LocationFinder } from "./finders/location-finder.ts";
import { MerchantFinder } from "./finders/merchant-finder.ts";
import { ProductFinder } from "./finders/product-finder.ts";
import { PurchaseFinder } from "./finders/purchase-finder.ts";
import { SaleFinder } from "./finders/sale-finder.ts";
import { SupplierFinder } from "./finders/supplier-finder.ts";
import { Environment, loadEnvironmentVariables } from "./infra/config.env.ts";
import { createLogger, noopLogger } from "./infra/config.logger.ts";
import { EmailSender } from "./integrations/email-sender.ts";
import { IdentityProvider } from "./integrations/identity-provider.ts";
import { ProductImageStore } from "./integrations/product-image-store.ts";
import { RealtimeEventPublisher } from "./integrations/realtime-event-publisher.ts";
import { EmployeeAuthorizationService } from "./services/employee-authorization-service.ts";
import { EmployeeManagement } from "./services/employee-management.ts";
import { InventoryManagement } from "./services/inventory-management.ts";
import { SyncTokenStore } from "./services/sync/sync-token-store.ts";

async function run() {
  console.clear();
  const environment = Environment.parse(process.env["NODE_ENV"]);
  const env = loadEnvironmentVariables(environment);

  const logger =
    environment === "test" ? noopLogger() : createLogger({ mode: environment === "development" ? "pretty" : "json" });

  const db = createDrizzle(env.DB_URL);
  await db.execute("SELECT 1");
  logger.debug(chalk.blue("✔ Database connection established successfully"));

  const cache = new Redis(env.REDIS_URL);
  await cache.ping();
  logger.debug(chalk.blue("✔ Redis connection established successfully"));

  const identity = new IdentityProvider(logger, env);
  const productImageStore = new ProductImageStore({ env, logger });
  const publisher = new RealtimeEventPublisher({ logger, env });
  const emailSender = new EmailSender({ logger, env });
  const employeeAuthorizationService = EmployeeAuthorizationService.create({ db });
  const employeeManagement = new EmployeeManagement(employeeAuthorizationService);
  const inventoryManagement = new InventoryManagement();
  const syncTokenStore = new SyncTokenStore(cache, env.CLERK_SECRET_KEY);

  const merchantFinder = new MerchantFinder();
  const collectionFinder = new CollectionFinder();
  const customerFinder = new CustomerFinder();
  const employeeFinder = new EmployeeFinder();
  const invitationFinder = new InvitationFinder();
  const locationFinder = new LocationFinder();
  const supplierFinder = new SupplierFinder();
  const productFinder = new ProductFinder(collectionFinder);
  const purchaseFinder = new PurchaseFinder();
  const saleFinder = new SaleFinder();

  const app = createApp({
    logger,
    env,
    db,
    cache,
    identity,
    emailSender,
    employeeAuthorizationService,
    employeeManagement,
    inventoryManagement,
    syncTokenStore,
    productImageStore,
    publisher,
    merchantFinder,
    collectionFinder,
    customerFinder,
    employeeFinder,
    invitationFinder,
    locationFinder,
    supplierFinder,
    productFinder,
    purchaseFinder,
    saleFinder,
  });

  serve({ fetch: app.fetch, port: env.PORT }, ({ address, port }) => {
    const host = env.NODE_ENV === "development" ? "localhost" : address;

    logger.debug(chalk.greenBright(`Mipyme ${env.NODE_ENV} server running!`));
    logger.debug(`${chalk.white("API:")}               ${chalk.greenBright(`http://${host}:${port}`)}`);
    logger.debug(`${chalk.white("Runtime version:")}   ${chalk.greenBright(process.versions.node)}`);
    logger.debug(`${chalk.white("CPU Architecture:")}  ${chalk.greenBright(process.arch)}`);
    logger.debug(`${chalk.white("Operating System:")}  ${chalk.greenBright(process.platform)}`);
    logger.debug(`${chalk.white("Environment:")}       ${chalk.greenBright(env.NODE_ENV)}`);
  });
}

const __IS_MAIN_MODULE__ = import.meta.url === `file://${process.argv[1]}`;

if (__IS_MAIN_MODULE__) {
  process.on("uncaughtException", (error) => {
    console.error(chalk.red("Uncaught Exception:"), error);
    process.exit(1);
  });

  run().catch((error) => {
    console.error(chalk.red("Error during startup:"), error);
    process.exit(1);
  });
}

export { run };
