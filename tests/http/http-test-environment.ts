import { MySqlContainer } from "@testcontainers/mysql";
import { RedisContainer } from "@testcontainers/redis";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { decodeJwt } from "jose";
import { createConnection } from "mysql2/promise";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import pino, { type Logger } from "pino";
import pretty from "pino-pretty";
import { createDrizzle } from "../../src/db/index.ts";
import { run } from "../../src/index.ts";
import { loadEnvironmentVariables, type Environment } from "../../src/infra/config.env.ts";
import { startProductImageStorage } from "./product-image-storage.ts";

type WorkflowEnvironment = Record<string, string>;
type WorkflowExecutor = (workflowEnvironment: WorkflowEnvironment) => Promise<void>;

class HttpTestEnvironment {
  private readonly environment: Environment;
  private readonly logger: Logger;
  private readonly sessionIds: Array<string> = [];

  constructor(environment: Environment) {
    this.logger = pino({ name: "http-tests", level: "info" }, pretty({ colorize: true }));
    this.environment = environment;
  }

  async run(executeWorkflows: WorkflowExecutor): Promise<void> {
    if (this.environment !== "test") {
      throw new Error("Only `test` environment is currently supported.");
    }

    const storage = await startProductImageStorage();
    await this.runWorkflows(storage.endpoint, executeWorkflows).finally(() => storage.close());
  }

  private async runWorkflows(storageEndpoint: string, executeWorkflows: WorkflowExecutor): Promise<void> {
    const port = await this.prepareTestEnvironment(storageEndpoint);
    const environment = loadEnvironmentVariables(this.environment);
    if (!environment.CLERK_TEST_USER_ID) {
      throw new Error("CLERK_TEST_USER_ID is required to run HTTP tests.");
    }

    try {
      const token = await this.generateToken(environment.CLERK_SECRET_KEY, environment.CLERK_TEST_USER_ID);
      await executeWorkflows({
        baseUrl: new URL("http://localhost:" + port).origin,
        storageEndpoint,
        token,
        testUserId: environment.CLERK_TEST_USER_ID,
      });
    } finally {
      await this.revokeSessions(environment.CLERK_SECRET_KEY);
    }
  }

  private async generateToken(secretKey: string, userId: string): Promise<string> {
    const headers = {
      Accept: "application/json",
      Authorization: "Bearer " + secretKey,
      "Content-Type": "application/json",
    };

    const sessionResponse = await fetch("https://api.clerk.com/v1/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ user_id: userId }),
    });

    if (!sessionResponse.ok) {
      const details = await sessionResponse.text();
      throw new Error("Clerk failed to create a session (" + sessionResponse.status + "): " + details);
    }

    const session = (await sessionResponse.json()) as { id: string };
    this.sessionIds.push(session.id);

    const tokenResponse = await fetch(
      "https://api.clerk.com/v1/sessions/" + encodeURIComponent(session.id) + "/tokens",
      {
        method: "POST",
        headers,
      },
    );

    if (!tokenResponse.ok) {
      const details = await tokenResponse.text();
      throw new Error("Clerk failed to create a session token (" + tokenResponse.status + "): " + details);
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
      const response = await fetch("https://api.clerk.com/v1/sessions/" + encodeURIComponent(sessionId) + "/revoke", {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + secretKey,
        },
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error("Clerk failed to revoke test session " + sessionId + " (" + response.status + "): " + details);
      }
    }
  }

  private async prepareTestEnvironment(storageEndpoint: string): Promise<number> {
    this.logger.info("💡 Preparing test environment");

    const mySqlContainer = await new MySqlContainer("mysql:8.4.8").start();
    this.logger.info("🔺 MySQL instance spun up");

    const redisContainer = await new RedisContainer("redis:8.2").start();
    this.logger.info("🔺 Redis instance spun up");

    const databasePort = mySqlContainer.getMappedPort(3306);
    const databasePassword = mySqlContainer.getRootPassword();
    const databaseUrl =
      "mysql://root:" + databasePassword + "@" + mySqlContainer.getHost() + ":" + databasePort + "/test";

    process.env["NODE_ENV"] = "test";
    process.env["DB_URL"] = databaseUrl;
    process.env["DB_HOST"] = mySqlContainer.getHost();
    process.env["DB_PORT"] = databasePort.toString();
    process.env["DB_USER"] = "root";
    process.env["DB_PASSWORD"] = mySqlContainer.getRootPassword();
    process.env["DB_NAME"] = "test";
    process.env["REDIS_URL"] = "redis://" + redisContainer.getHost() + ":" + redisContainer.getMappedPort(6379);
    process.env["BUCKET_STORAGE_ENDPOINT"] = storageEndpoint;
    process.env["BUCKET_STORAGE_REGION"] = "us-east-1";
    process.env["BUCKET_STORAGE_ACCESS_KEY_ID"] = "test-storage-key";
    process.env["BUCKET_STORAGE_SECRET_ACCESS_KEY"] = "test-storage-secret";
    process.env["BUCKET_STORAGE_BUCKET_NAME"] = "product-photos";
    process.env["BUCKET_STORAGE_FORCE_PATH_STYLE"] = "true";
    process.env["BUCKET_STORAGE_PUBLIC_BASE_URL"] = storageEndpoint;

    await this.migrateDatabase(databaseUrl);
    const port = await this.findAvailablePort();
    process.env["PORT"] = port.toString();
    await run();

    return port;
  }

  private async findAvailablePort(): Promise<number> {
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

  private async migrateDatabase(url: string): Promise<void> {
    const connection = await createConnection(url);

    await connection.query("DROP DATABASE IF EXISTS test");
    await connection.query("CREATE DATABASE test");

    await connection.end();

    const database = createDrizzle(url);
    await migrate(database, { migrationsFolder: "./src/db/migrations" });
    this.logger.info("✅ Migration applied successfully");
    database.$client.end();
  }
}

export { HttpTestEnvironment };
