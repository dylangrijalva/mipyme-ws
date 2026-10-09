import { runFromFile, type WorkflowResult } from "@stepci/runner";
import { MySqlContainer } from "@testcontainers/mysql";
import { RedisContainer } from "@testcontainers/redis";
import chalk from "chalk";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createConnection } from "mysql2/promise";
import { readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pino, { type Logger } from "pino";
import pretty from "pino-pretty";
import { createDrizzle } from "../../src/db/index.ts";
import { run } from "../../src/index.ts";
import type { Environment } from "../../src/infra/config.env.ts";

class HttpTestRunner {
  private readonly environment: Environment;
  private readonly logger: Logger;

  constructor(environment: Environment) {
    this.logger = pino({ name: "http-tests", level: "info" }, pretty({ colorize: true }));
    this.environment = environment;
  }

  async run(): Promise<void> {
    const __IS_TEST_ENVIRONMENT__ = this.environment === "test";
    if (__IS_TEST_ENVIRONMENT__) {
      const PORT = await this.prepareTestEnvironment();
      await this.runTests(new URL(`http://localhost:${PORT}`));
      return;
    }

    throw new Error("Only `test` environment is currently supported.");
  }

  private async runTests(baseUrl: URL) {
    const WORKFLOWS_DIRECTORY = fileURLToPath(new URL("./workflows/", import.meta.url));
    const entries = await readdir(WORKFLOWS_DIRECTORY, { withFileTypes: true });

    const workflowEntries = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.yml"))
      .map((entry) => resolve(WORKFLOWS_DIRECTORY, entry.name))
      .sort();

    for (const workflowEntry of workflowEntries) {
      const workflow = basename(workflowEntry);
      const { result } = await runFromFile(workflowEntry, { env: { baseUrl: baseUrl.origin } });
      this.reportWorkflowResult(workflow, result);
    }
  }

  private reportWorkflowResult(workflow: string, result: WorkflowResult["result"]) {
    const steps = result.tests.flatMap((test) => test.steps);
    const passedTestCount = result.tests.filter((test) => test.passed).length;
    const passedStepCount = steps.filter((step) => step.passed && !step.skipped).length;
    const failedStepCount = steps.filter((step) => !step.passed && !step.skipped).length;
    const skippedStepCount = steps.filter((step) => step.skipped).length;
    const lines = [
      `${result.passed ? chalk.green("✅ PASSED") : chalk.red("❌ FAILED")} ${chalk.bold(workflow)}`,
      chalk.gray(
        `${passedTestCount}/${result.tests.length} tests passed · ${passedStepCount}/${steps.length} steps passed · ${failedStepCount} failed · ${skippedStepCount} skipped · ${result.duration}ms · ${result.bytesSent} B sent / ${result.bytesReceived} B received`,
      ),
    ];

    const formatValue = (value: unknown) => JSON.stringify(value) ?? String(value);
    const appendChecks = (checks: unknown, parentName = "") => {
      if (typeof checks !== "object" || checks === null) return;

      for (const [checkName, checkResult] of Object.entries(checks)) {
        const fullName = parentName ? `${parentName}.${checkName}` : checkName;

        if (
          typeof checkResult === "object" &&
          checkResult !== null &&
          "passed" in checkResult &&
          typeof checkResult.passed === "boolean"
        ) {
          lines.push(
            `    ${checkResult.passed ? "✅" : "❌"} ${fullName}: ${checkResult.passed ? chalk.green("passed") : chalk.red("failed")}`,
          );
          lines.push(
            chalk.gray(
              `       expected ${formatValue(checkResult.expected)}, received ${formatValue(checkResult.given)}`,
            ),
          );
          continue;
        }

        appendChecks(checkResult, fullName);
      }
    };

    for (const test of result.tests) {
      lines.push(
        `\n  ${test.passed ? "✅" : "❌"} ${chalk.bold(test.name ?? test.id)} ${chalk.gray(`${test.duration}ms`)}`,
      );

      for (const step of test.steps) {
        const statusIcon = step.skipped ? "⏭️" : step.passed ? "✅" : "❌";
        const statusLabel = step.skipped
          ? chalk.yellow("skipped")
          : step.passed
            ? chalk.green("passed")
            : step.errored
              ? chalk.red("error")
              : chalk.red("failed");

        lines.push(
          `    ${statusIcon} ${step.name ?? step.id ?? step.type ?? "Unnamed step"} ${statusLabel} ${chalk.gray(`${step.duration}ms`)}`,
        );

        if (step.response?.status !== undefined) {
          lines.push(chalk.gray(`       HTTP ${step.response.status} · response ${step.responseTime}ms`));
        }

        if (step.errorMessage) lines.push(`       ${chalk.red(step.errorMessage)}`);
        appendChecks(step.checks);
      }
    }

    console.log(lines.join("\n"));
  }

  private async prepareTestEnvironment() {
    this.logger.info("💡 Preparing test environment");

    const mySqlContainer = await new MySqlContainer("mysql:8.4.8").start();
    this.logger.info("✅ MySQL instance spun up");

    const redisContainer = await new RedisContainer("redis:8.2").start();
    this.logger.info("✅ Redis instance spun up");

    const DB_PORT = mySqlContainer.getMappedPort(3306);
    const DB_PASSWORD = mySqlContainer.getRootPassword();
    const databaseUrl = `mysql://root:${DB_PASSWORD}@${mySqlContainer.getHost()}:${DB_PORT}/test`;

    process.env["PORT"] = "3000".toString();
    process.env["NODE_ENV"] = "test";
    process.env["NODE_ENV"] = "test";
    process.env["DB_URL"] = databaseUrl;
    process.env["DB_HOST"] = mySqlContainer.getHost();
    process.env["DB_PORT"] = DB_PORT.toString();
    process.env["DB_USER"] = "root";
    process.env["DB_PASSWORD"] = mySqlContainer.getRootPassword();
    process.env["DB_NAME"] = "test";
    process.env["REDIS_URL"] = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    await this.migrateDatabase(databaseUrl);
    await run();

    return process.env["PORT"].toString();
  }

  private async migrateDatabase(url: string) {
    const connection = await createConnection(url);

    await connection.query("DROP DATABASE IF EXISTS test");
    await connection.query("CREATE DATABASE test");

    await connection.end();

    const db = createDrizzle(url);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    this.logger.info("✅ Migration applied successfully");
    db.$client.end();
  }
}

export { HttpTestRunner };
