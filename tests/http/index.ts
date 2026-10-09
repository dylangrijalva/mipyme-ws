import { runFromFile } from "@stepci/runner";
import { MySqlContainer, StartedMySqlContainer } from "@testcontainers/mysql";
import { RedisContainer, StartedRedisContainer } from "@testcontainers/redis";
import chalk from "chalk";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createConnection } from "mysql2/promise";
import { readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import pretty from "pino-pretty";
import { createDrizzle } from "../../src/db/index.ts";
import { run } from "../../src/index.ts";

const logger = pino({ name: "http-tests", level: "info" }, pretty({ colorize: true }));

function logCheckResult(checkName: string, checkResult: unknown, logLevel: "info" | "error"): void {
  if (typeof checkResult !== "object" || checkResult === null) {
    return;
  }

  if (
    "passed" in checkResult &&
    typeof checkResult.passed === "boolean" &&
    "expected" in checkResult &&
    "given" in checkResult
  ) {
    const formatValue = (value: unknown) => JSON.stringify(value) ?? String(value);
    const checkMessage = `${checkName} check ${checkResult.passed ? "passed" : "failed"} (expected: ${formatValue(checkResult.expected)}, received: ${formatValue(checkResult.given)}).`;

    logger[logLevel](
      `       ${checkResult.passed ? chalk.green(`✅ ${checkMessage}`) : chalk.red(`❌ ${checkMessage}`)}`,
    );
    return;
  }

  for (const [nestedCheckName, nestedCheckResult] of Object.entries(checkResult)) {
    logCheckResult(`${checkName} ${nestedCheckName}`, nestedCheckResult, logLevel);
  }
}

async function migrateDatabase(url: string) {
  const connection = await createConnection(url);

  await connection.query("DROP DATABASE IF EXISTS test");
  await connection.query("CREATE DATABASE test");

  await connection.end();

  const db = createDrizzle(url);
  logger.info("Applying database migrations");
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  logger.info("Database migrations applied successfully");
  db.$client.end();
}

let mySqlContainer: StartedMySqlContainer | undefined;
let redisContainer: StartedRedisContainer | undefined;

async function prepareTestEnvironment() {
  mySqlContainer = await new MySqlContainer("mysql:8.4.8").start();
  logger.info(
    { host: mySqlContainer.getHost(), port: mySqlContainer.getMappedPort(3306) },
    "MySQL test container started",
  );

  redisContainer = await new RedisContainer("redis:8.2").start();
  logger.info(
    { host: redisContainer.getHost(), port: redisContainer.getMappedPort(6379) },
    "Redis test container started",
  );

  const DB_PORT = mySqlContainer.getMappedPort(3306);
  const DB_PASSWORD = mySqlContainer.getRootPassword();

  process.env["NODE_ENV"] = "test";
  process.env["DB_URL"] = `mysql://root:${DB_PASSWORD}@${mySqlContainer.getHost()}:${DB_PORT}/test`;
  process.env["DB_HOST"] = mySqlContainer.getHost();
  process.env["DB_PORT"] = DB_PORT.toString();
  process.env["DB_USER"] = "root";
  process.env["DB_PASSWORD"] = mySqlContainer.getRootPassword();
  process.env["DB_NAME"] = "test";
  process.env["REDIS_URL"] = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

  await migrateDatabase(`mysql://root:${DB_PASSWORD}@${mySqlContainer.getHost()}:${DB_PORT}/test`);
  await run();
}

async function runHttpTests(baseUrl: URL) {
  const WORKFLOWS_DIRECTORY = fileURLToPath(new URL("./workflows/", import.meta.url));
  const entries = await readdir(WORKFLOWS_DIRECTORY, { withFileTypes: true });

  const workflowEntries = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.yml"))
    .map((entry) => resolve(WORKFLOWS_DIRECTORY, entry.name))
    .sort();

  for (const workflowEntry of workflowEntries) {
    const workflow = basename(workflowEntry);
    const { result } = await runFromFile(workflowEntry, { env: { baseUrl: baseUrl.origin } });
    const resultLabel = result.passed ? chalk.green("✅") : chalk.red("❌");
    const logLevel = result.passed ? "info" : "error";

    logger[result.passed ? "info" : "error"](
      `${resultLabel} Workflow ${chalk.yellow(workflow)} completed in ${chalk.yellow(`${result.duration} ms.`)}`,
    );

    for (const test of result.tests) {
      logger[logLevel](
        `   > ${test.passed ? chalk.green("✅") : chalk.red("❌")} Test ${chalk.yellowBright(`${test.name ?? "(unnamed)"}`)} ${test.passed ? "passed." : "failed."}`,
      );
      for (const step of test.steps) {
        logger[logLevel](
          `     > ${step.passed ? chalk.green("✅") : chalk.red("❌")} Step ${chalk.yellowBright(step.name)} ${step.passed ? "passed." : "failed."}`,
        );

        for (const [checkName, checkResult] of Object.entries(step.checks ?? {})) {
          logCheckResult(checkName, checkResult, logLevel);
        }
      }
    }
  }
}

async function bootstrap() {
  await prepareTestEnvironment();
  await runHttpTests(new URL("http://localhost:3000"));
}

bootstrap()
  .catch((error: unknown) => {
    logger.error({ err: error }, "Error during HTTP tests");
    process.exitCode = 1;
  })
  .finally(async () => {
    //await clean();
    logger.flush(() => process.exit(process.exitCode ?? 0));
  });
