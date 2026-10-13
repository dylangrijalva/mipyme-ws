import { runFromFile, type WorkflowResult } from "@stepci/runner";
import { MySqlContainer } from "@testcontainers/mysql";
import { RedisContainer } from "@testcontainers/redis";
import chalk from "chalk";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { decodeJwt } from "jose";
import { createConnection } from "mysql2/promise";
import { readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pino, { type Logger } from "pino";
import pretty from "pino-pretty";
import { createDrizzle } from "../../src/db/index.ts";
import { run } from "../../src/index.ts";
import { loadEnvironmentVariables, type Environment } from "../../src/infra/config.env.ts";

import { preparePendingSaleFixture } from "./fixtures/pending-sales.ts";

class HttpTestRunner {
  private readonly environment: Environment;
  private readonly logger: Logger;
  private readonly sessionIds: Array<string> = [];
  private readonly workflowNames: Array<string>;
  private readonly verbose: boolean;

  constructor(environment: Environment, workflowNames: Array<string> = [], verbose = false) {
    this.logger = pino({ name: "http-tests", level: "info" }, pretty({ colorize: true }));
    this.environment = environment;
    this.workflowNames = workflowNames;
    this.verbose = verbose;
  }

  async run(): Promise<void> {
    if (this.environment !== "test") {
      throw new Error("Only `test` environment is currently supported.");
    }

    const PORT = await this.prepareTestEnvironment();
    const env = loadEnvironmentVariables(this.environment);

    if (!env.CLERK_TEST_USER_ID) {
      throw new Error("CLERK_TEST_USER_ID is required to run HTTP tests.");
    }

    try {
      const token = await this.generateToken(env.CLERK_SECRET_KEY, env.CLERK_TEST_USER_ID);
      await this.runTests(new URL(`http://localhost:${PORT}`), token, env.CLERK_TEST_USER_ID);
    } finally {
      await this.revokeSessions(env.CLERK_SECRET_KEY);
    }
  }

  private async generateToken(secretKey: string, userId: string): Promise<string> {
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    };

    const sessionResponse = await fetch("https://api.clerk.com/v1/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ user_id: userId }),
    });

    if (!sessionResponse.ok) {
      const details = await sessionResponse.text();
      throw new Error(`Clerk failed to create a session (${sessionResponse.status}): ${details}`);
    }

    const session = (await sessionResponse.json()) as { id: string };
    this.sessionIds.push(session.id);

    const tokenResponse = await fetch(`https://api.clerk.com/v1/sessions/${encodeURIComponent(session.id)}/tokens`, {
      method: "POST",
      headers,
    });

    if (!tokenResponse.ok) {
      const details = await tokenResponse.text();
      throw new Error(`Clerk failed to create a session token (${tokenResponse.status}): ${details}`);
    }

    const token = (await tokenResponse.json()) as { jwt: string };
    const payload = decodeJwt(token.jwt);
    const currentTime = Math.floor(Date.now() / 1000);

    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") {
      throw new Error("Clerk returned a session token without the required JWT claims.");
    }

    if (payload.exp <= currentTime) {
      throw new Error("Clerk returned an expired session token.");
    }

    return token.jwt;
  }

  private async revokeSessions(secretKey: string): Promise<void> {
    for (const sessionId of this.sessionIds) {
      const response = await fetch(`https://api.clerk.com/v1/sessions/${encodeURIComponent(sessionId)}/revoke`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${secretKey}`,
        },
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(`Clerk failed to revoke test session ${sessionId} (${response.status}): ${details}`);
      }
    }
  }

  private async runTests(baseUrl: URL, token: string, testUserId: string) {
    const WORKFLOWS_DIRECTORY = fileURLToPath(new URL("./workflows/", import.meta.url));
    const entries = await readdir(WORKFLOWS_DIRECTORY, { withFileTypes: true });

    const availableWorkflowEntries = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.yaml"))
      .map((entry) => resolve(WORKFLOWS_DIRECTORY, entry.name))
      .sort();

    const selectedWorkflowEntries =
      this.workflowNames.length === 0
        ? availableWorkflowEntries
        : this.workflowNames.map((name) => {
            const filename = name.endsWith(".spec.yaml") ? name : `${name}.spec.yaml`;
            const workflowEntry = availableWorkflowEntries.find((entry) => basename(entry) === filename);
            if (!workflowEntry) {
              throw new Error(`Unknown HTTP workflow: ${name}`);
            }
            return workflowEntry;
          });

    const workflowEntries = [...new Set(selectedWorkflowEntries)].sort();

    for (const workflowEntry of workflowEntries) {
      const workflow = basename(workflowEntry);
      const database = workflow === "pending-sales.spec.yaml" ? createDrizzle(process.env["DB_URL"]!) : undefined;
      try {
        const fixture = database ? await preparePendingSaleFixture(database, testUserId) : undefined;
        try {
          const { result } = await runFromFile(workflowEntry, {
            env: { baseUrl: baseUrl.origin, token, testUserId, ...fixture?.environment },
          });
          this.reportWorkflowResult(workflow, result);

          if (!result.passed) {
            throw new Error(`HTTP workflow failed: ${workflow}`);
          }
          await fixture?.verify();
        } finally {
          await fixture?.cleanup();
        }
      } finally {
        await database?.$client.promise().end();
      }
    }
  }

  private reportWorkflowResult(workflow: string, result: WorkflowResult["result"]) {
    const formatStatusIcon = (passed: boolean) => (passed ? chalk.green("✓") : chalk.red("✗"));
    const formatDuration = (duration: unknown, numberColor = chalk.yellow) =>
      `${numberColor(String(duration))}${chalk.yellow.dim("ms")}`;
    const formatTestResult = (test: (typeof result.tests)[number]) =>
      `  ${formatStatusIcon(test.passed)} ${test.name ?? test.id} ${formatDuration(test.duration)}`;
    const summary = `${formatStatusIcon(result.passed)}  ${chalk.bgMagenta.black("http")} ${chalk.gray(`tests/http/workflows/${workflow}`)} ${chalk.gray(`(${result.tests.length} tests)`)} ${formatDuration(result.duration)}`;

    if (!this.verbose) {
      console.log([summary, ...result.tests.map(formatTestResult)].join("\n"));
      return;
    }

    const steps = result.tests.flatMap((test) => test.steps);
    const passedTestCount = result.tests.filter((test) => test.passed).length;
    const passedStepCount = steps.filter((step) => step.passed && !step.skipped).length;
    const failedStepCount = steps.filter((step) => !step.passed && !step.skipped).length;
    const skippedStepCount = steps.filter((step) => step.skipped).length;
    const lines = [
      summary,
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
            `    ${checkResult.passed ? "✓" : "✗"} ${fullName}: ${checkResult.passed ? chalk.green("passed") : chalk.red("failed")}`,
          );
          const isPassedSchema = fullName === "schema" && checkResult.passed;
          const expected = isPassedSchema ? "[json]" : formatValue(checkResult.expected);
          const received = isPassedSchema ? "[json]" : formatValue(checkResult.given);
          const valueColor = checkResult.passed ? chalk.cyan : chalk.red;
          lines.push(
            `${chalk.gray("       expected ")}${valueColor(expected)}${chalk.gray(", received ")}${valueColor(received)}`,
          );
          continue;
        }

        appendChecks(checkResult, fullName);
      }
    };

    for (const test of result.tests) {
      lines.push(formatTestResult(test));

      for (const step of test.steps) {
        const statusIcon = step.skipped ? "⏭️" : step.passed ? "✓" : "✗";
        const statusLabel = step.skipped
          ? chalk.yellow("skipped")
          : step.passed
            ? chalk.green("passed")
            : step.errored
              ? chalk.red("error")
              : chalk.red("failed");

        lines.push(
          `    ${statusIcon} ${step.name ?? step.id ?? step.type ?? "Unnamed step"} ${statusLabel} ${formatDuration(step.duration, chalk.gray)}`,
        );

        if (step.response?.status !== undefined) {
          lines.push(
            `${chalk.gray(`       HTTP ${step.response.status} · response `)}${formatDuration(step.responseTime, chalk.gray)}`,
          );
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
    this.logger.info("🔺 MySQL instance spun up");

    const redisContainer = await new RedisContainer("redis:8.2").start();
    this.logger.info("🔺 Redis instance spun up");

    const DB_PORT = mySqlContainer.getMappedPort(3306);
    const DB_PASSWORD = mySqlContainer.getRootPassword();
    const databaseUrl = `mysql://root:${DB_PASSWORD}@${mySqlContainer.getHost()}:${DB_PORT}/test`;

    process.env["PORT"] = "5000".toString();
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
