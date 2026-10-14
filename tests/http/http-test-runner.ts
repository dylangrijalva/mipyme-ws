import { run as runWorkflow, runFromFile, runFromYAML, type Workflow, type WorkflowResult } from "@stepci/runner";
import { MySqlContainer } from "@testcontainers/mysql";
import { RedisContainer } from "@testcontainers/redis";
import chalk from "chalk";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { decodeJwt } from "jose";
import { createConnection } from "mysql2/promise";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pino, { type Logger } from "pino";
import pretty from "pino-pretty";
import { parse } from "yaml";
import { createDrizzle, type Database } from "../../src/db/index.ts";
import { tables } from "../../src/db/schema.ts";
import { run } from "../../src/index.ts";
import { loadEnvironmentVariables, type Environment } from "../../src/infra/config.env.ts";
import { generateId } from "../../src/utils/generate-id.ts";

import { seedPurchaseReads } from "../test-utils/purchase-read-fixture.ts";

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
      if (workflow === "sales.spec.yaml") {
        await this.runSalesWorkflow(workflowEntry, baseUrl, token, testUserId);
        continue;
      }
      const database = workflow === "purchases.spec.yaml" ? createDrizzle(process.env["DB_URL"]!) : undefined;
      try {
        const fixture = database ? await this.preparePurchaseReadWorkflow(database, testUserId) : undefined;
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

  private async runSalesWorkflow(workflowEntry: string, baseUrl: URL, token: string, testUserId: string) {
    const workflow = parse(await readFile(workflowEntry, "utf8"), { merge: true }) as Workflow;
    const { pendingCheckout, ...tests } = workflow.tests;
    const environment = { baseUrl: baseUrl.origin, token, testUserId };
    const sales = await runFromYAML(JSON.stringify({ ...workflow, tests }), {
      path: workflowEntry,
      env: environment,
    });
    if (!sales.result.passed) {
      this.reportWorkflowResult(basename(workflowEntry), sales.result);
      throw new Error(`HTTP workflow failed: ${basename(workflowEntry)}`);
    }

    const database = createDrizzle(process.env["DB_URL"]!);
    try {
      const fixture = await this.preparePendingSaleWorkflow(database, testUserId);
      try {
        const pendingSales = await runWorkflow(
          { ...sales.workflow, before: undefined, tests: { pendingCheckout } },
          { path: workflowEntry, env: { ...environment, ...fixture.environment } },
        );
        const result = {
          ...sales.result,
          tests: [...sales.result.tests, ...pendingSales.result.tests],
          passed: pendingSales.result.passed,
          duration: sales.result.duration + pendingSales.result.duration,
          bytesSent: sales.result.bytesSent + pendingSales.result.bytesSent,
          bytesReceived: sales.result.bytesReceived + pendingSales.result.bytesReceived,
          co2: sales.result.co2 + pendingSales.result.co2,
        };
        this.reportWorkflowResult(basename(workflowEntry), result);
        if (!result.passed) {
          throw new Error(`HTTP workflow failed: ${basename(workflowEntry)}`);
        }
        await fixture.verify();
      } finally {
        await fixture.cleanup();
      }
    } finally {
      await database.$client.promise().end();
    }
  }

  private async preparePurchaseReadWorkflow(db: Database, testUserId: string) {
    const [account] = await db.select().from(tables.account).where(eq(tables.account.externalId, testUserId));
    const [employee] = account
      ? await db.select().from(tables.employee).where(eq(tables.employee.accountId, account.id))
      : [];
    const context = await seedPurchaseReads(
      db,
      employee ? { merchantId: employee.merchantId, employeeId: employee.id } : undefined,
    );
    const accountId = account?.id ?? generateId({ model: "account" });
    if (!account) {
      await db.insert(tables.account).values({
        id: accountId,
        merchantId: context.merchantId,
        externalId: testUserId,
        email: "nami@strawhatpirates.example.com",
      });
      await db.update(tables.employee).set({ accountId }).where(eq(tables.employee.id, context.employeeId));
    }
    const purchasesBefore = await db
      .select()
      .from(tables.purchaseOrder)
      .where(inArray(tables.purchaseOrder.id, context.ids))
      .orderBy(tables.purchaseOrder.id);
    const itemsBefore = await db
      .select()
      .from(tables.purchaseOrderItem)
      .where(eq(tables.purchaseOrderItem.id, context.itemId));
    return {
      environment: {
        purchaseId: context.ids[1],
        newestPurchaseId: context.ids[3],
        secondPurchaseId: context.ids[0],
        oldestPurchaseId: context.ids[2],
        foreignPurchaseId: context.ids[4],
        purchaseLocationId: context.locationId,
        purchaseSupplierId: context.supplierId,
        purchaseVariantId: context.variantId,
      },
      async verify() {
        assert.deepEqual(
          await db
            .select()
            .from(tables.purchaseOrder)
            .where(inArray(tables.purchaseOrder.id, context.ids))
            .orderBy(tables.purchaseOrder.id),
          purchasesBefore,
        );
        assert.deepEqual(
          await db.select().from(tables.purchaseOrderItem).where(eq(tables.purchaseOrderItem.id, context.itemId)),
          itemsBefore,
        );
      },
      async cleanup() {
        await db.transaction(async (transaction) => {
          await transaction.delete(tables.purchaseOrderItem).where(eq(tables.purchaseOrderItem.id, context.itemId));
          await transaction.delete(tables.purchaseOrder).where(inArray(tables.purchaseOrder.id, context.ids));
          await transaction.delete(tables.variant).where(eq(tables.variant.id, context.variantId));
          await transaction.delete(tables.product).where(eq(tables.product.id, context.productId));
          await transaction
            .delete(tables.supplier)
            .where(
              inArray(tables.supplier.id, [context.supplierId, context.otherSupplierId, context.foreignSupplierId]),
            );
          await transaction
            .delete(tables.location)
            .where(
              inArray(tables.location.id, [
                context.locationId,
                context.inaccessibleLocationId,
                context.foreignLocationId,
              ]),
            );
          await transaction.delete(tables.employee).where(eq(tables.employee.merchantId, context.otherMerchantId));
          await transaction.delete(tables.merchant).where(eq(tables.merchant.id, context.otherMerchantId));
          if (!account) {
            await transaction.delete(tables.employee).where(eq(tables.employee.id, context.employeeId));
            await transaction.delete(tables.account).where(eq(tables.account.id, accountId));
            await transaction.delete(tables.merchant).where(eq(tables.merchant.id, context.merchantId));
          }
        });
      },
    };
  }

  private async preparePendingSaleWorkflow(db: Database, testUserId: string) {
    const [account] = await db.select().from(tables.account).where(eq(tables.account.externalId, testUserId));
    const merchantId = account?.merchantId ?? generateId({ model: "merchant" });
    const accountId = account?.id ?? generateId({ model: "account" });
    if (!account) {
      await db.insert(tables.merchant).values({ id: merchantId, name: "Straw Hat Pirates" });
      await db.insert(tables.account).values({
        id: accountId,
        merchantId,
        externalId: testUserId,
        email: "nami@strawhatpirates.example.com",
      });
      await db.insert(tables.employee).values({
        id: generateId({ model: "employee" }),
        merchantId,
        accountId,
        name: "Nami",
        isOwner: true,
        status: "enabled",
      });
    }

    const webLocationId = generateId({ model: "location" });
    const mobileLocationId = generateId({ model: "location" });
    const locationIds = [webLocationId, mobileLocationId];
    const productId = generateId({ model: "product" });
    const variantId = generateId({ model: "variant" });
    await db.insert(tables.location).values([
      { id: webLocationId, merchantId, name: "Water 7", allowBackorders: true, nextSaleNumber: 42 },
      { id: mobileLocationId, merchantId, name: "Dressrosa", allowBackorders: false, nextSaleNumber: 42 },
    ]);
    await db.insert(tables.product).values({
      id: productId,
      merchantId,
      name: "Nami's mandarins",
      slug: productId,
      type: "item",
      status: "active",
      price: "100.00",
      unitCost: "50.00",
    });
    await db
      .insert(tables.variant)
      .values({ id: variantId, merchantId, productId, name: "Mandarin crate", price: "100.00" });
    await db.insert(tables.inventoryLevel).values(
      locationIds.map((locationId) => ({
        id: generateId({ model: "inventoryLevel" }),
        merchantId,
        locationId,
        variantId,
        onHand: 2,
      })),
    );
    const inventoryBefore = await db
      .select()
      .from(tables.inventoryLevel)
      .where(eq(tables.inventoryLevel.variantId, variantId))
      .orderBy(tables.inventoryLevel.id);
    const productsBefore = await db.select().from(tables.product).where(eq(tables.product.id, productId));

    return {
      environment: { webLocationId, mobileLocationId, pendingVariantId: variantId },
      async cleanup() {
        await db.transaction(async (transaction) => {
          const sales = await transaction
            .select({ id: tables.sale.id })
            .from(tables.sale)
            .where(inArray(tables.sale.locationId, locationIds));
          const saleIds = sales.map((sale) => sale.id);
          if (saleIds.length > 0) {
            await transaction
              .delete(tables.inventoryMovement)
              .where(inArray(tables.inventoryMovement.referenceId, saleIds));
            await transaction.delete(tables.salePayment).where(inArray(tables.salePayment.saleId, saleIds));
            await transaction.delete(tables.saleItem).where(inArray(tables.saleItem.saleId, saleIds));
            await transaction.delete(tables.sale).where(inArray(tables.sale.id, saleIds));
          }
          await transaction.delete(tables.inventoryLevel).where(eq(tables.inventoryLevel.variantId, variantId));
          await transaction.delete(tables.variant).where(eq(tables.variant.id, variantId));
          await transaction.delete(tables.product).where(eq(tables.product.id, productId));
          await transaction.delete(tables.location).where(inArray(tables.location.id, locationIds));
          if (!account) {
            await transaction.delete(tables.employee).where(eq(tables.employee.accountId, accountId));
            await transaction.delete(tables.account).where(eq(tables.account.id, accountId));
            await transaction.delete(tables.merchant).where(eq(tables.merchant.id, merchantId));
          }
        });
      },
      async verify() {
        assert.deepEqual(
          await db
            .select()
            .from(tables.inventoryLevel)
            .where(eq(tables.inventoryLevel.variantId, variantId))
            .orderBy(tables.inventoryLevel.id),
          inventoryBefore,
        );
        assert.deepEqual(
          await db.select().from(tables.product).where(eq(tables.product.id, productId)),
          productsBefore,
        );
        const sales = await db.select().from(tables.sale).where(inArray(tables.sale.locationId, locationIds));
        assert.equal(sales.length, 3);
        assert.deepEqual(
          sales.filter((sale) => sale.locationId === webLocationId).map((sale) => sale.transactionNumber),
          [42],
        );
        assert.deepEqual(
          sales
            .filter((sale) => sale.locationId === mobileLocationId)
            .map((sale) => sale.transactionNumber)
            .sort(),
          [42, 43],
        );
        for (const sale of sales) {
          assert.equal(sale.status, "pending");
          const items = await db.select().from(tables.saleItem).where(eq(tables.saleItem.saleId, sale.id));
          assert.equal(items.length, 1);
          assert.equal(items[0]!.variantId, variantId);
          assert.equal(items[0]!.quantity, 5);
          assert.equal(items[0]!.shortageQuantity, 3);
          const payments = await db.select().from(tables.salePayment).where(eq(tables.salePayment.saleId, sale.id));
          assert.equal(payments.length, 1);
          assert.equal(payments[0]!.amount, "500.00");
          assert.equal(payments[0]!.method, "cash");
        }
        assert.equal(
          (
            await db
              .select()
              .from(tables.inventoryMovement)
              .where(
                inArray(
                  tables.inventoryMovement.referenceId,
                  sales.map((sale) => sale.id),
                ),
              )
          ).length,
          0,
        );
        const locations = await db.select().from(tables.location).where(inArray(tables.location.id, locationIds));
        assert.equal(locations.find((location) => location.id === webLocationId)?.nextSaleNumber, 43);
        assert.equal(locations.find((location) => location.id === mobileLocationId)?.nextSaleNumber, 44);
      },
    };
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

    process.env["NODE_ENV"] = "test";
    process.env["DB_URL"] = databaseUrl;
    process.env["DB_HOST"] = mySqlContainer.getHost();
    process.env["DB_PORT"] = DB_PORT.toString();
    process.env["DB_USER"] = "root";
    process.env["DB_PASSWORD"] = mySqlContainer.getRootPassword();
    process.env["DB_NAME"] = "test";
    process.env["REDIS_URL"] = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    await this.migrateDatabase(databaseUrl);
    const port = await this.findAvailablePort();
    process.env["PORT"] = port.toString();
    await run();

    return port;
  }

  private async findAvailablePort() {
    const server = createServer();
    const listening = once(server, "listening");
    server.listen(0);
    await listening;
    const address = server.address();
    assert(address && typeof address !== "string");
    const closed = once(server, "close");
    server.close();
    await closed;
    return address.port;
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
