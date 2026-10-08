import { serve } from "@hono/node-server";
import chalk from "chalk";
import { Redis } from "ioredis";
import { createApp } from "./app.ts";
import { createDrizzle } from "./db/index.ts";
import { CollectionFinder } from "./finders/collection-finder.ts";
import { CustomerFinder } from "./finders/customer-finder.ts";
import { MerchantFinder } from "./finders/merchant-finder.ts";
import { PurchaseFinder } from "./finders/purchase-finder.ts";
import { ProductFinder } from "./finders/product-finder.ts";
import { SupplierFinder } from "./finders/supplier-finder.ts";
import { Environment, loadEnvironmentVariables } from "./infra/config.env.ts";
import { createLogger } from "./infra/config.logger.ts";
import { IdentityProvider } from "./integrations/identity-provider.ts";

async function run() {
  console.clear();
  const environment = Environment.parse(process.env["NODE_ENV"]);
  const env = loadEnvironmentVariables(environment);

  const LOGGER_MODE = environment === "development" ? "pretty" : "json";
  const logger = createLogger({ mode: LOGGER_MODE });

  const db = createDrizzle(env.DB_URL);
  await db.execute("SELECT 1");
  logger.debug(chalk.blue("✔ Database connection established successfully"));

  const cache = new Redis(env.REDIS_URL);
  await cache.ping();
  logger.debug(chalk.blue("✔ Redis connection established successfully"));

  const identity = new IdentityProvider(logger, env);

  const merchantFinder = new MerchantFinder();
  const collectionFinder = new CollectionFinder();
  const customerFinder = new CustomerFinder();
  const supplierFinder = new SupplierFinder();
  const productFinder = new ProductFinder();
  const purchaseFinder = new PurchaseFinder();

  const app = createApp({
    logger,
    env,
    db,
    cache,
    identity,
    merchantFinder,
    collectionFinder,
    customerFinder,
    supplierFinder,
    productFinder,
    purchaseFinder,
  });

  serve({ fetch: app.fetch, port: env.PORT }, ({ address, port }) => {
    const host = env.NODE_ENV === "development" ? "localhost" : address;

    logger.debug(chalk.greenBright(`Facilito ${env.NODE_ENV} server running!`));
    logger.debug(`${chalk.white("API:")}               ${chalk.greenBright(`http://${host}:${port}`)}`);
    logger.debug(`${chalk.white("Runtime version:")}   ${chalk.greenBright(process.versions.node)}`);
    logger.debug(`${chalk.white("CPU Architecture:")}  ${chalk.greenBright(process.arch)}`);
    logger.debug(`${chalk.white("Operating System:")}  ${chalk.greenBright(process.platform)}`);
    logger.debug(`${chalk.white("Environment:")}       ${chalk.greenBright(env.NODE_ENV)}`);
  });
}

process.on("uncaughtException", (error) => {
  console.error(chalk.red("Uncaught Exception:"), error);
  process.exit(1);
});

run().catch((error) => {
  console.error(chalk.red("Error during startup:"), error);
  process.exit(1);
});
