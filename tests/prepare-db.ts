import { getTableName } from "drizzle-orm";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createConnection } from "mysql2/promise";
import { afterAll, inject } from "vitest";
import { createDrizzle, type Database } from "../src/db/index.ts";
import { tables } from "../src/db/schema.ts";
import { generateId } from "../src/utils/generate-id.ts";

const tableNames = Object.values(tables).map((table) => getTableName(table));

type MySqlConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
};

type TestDatabase = ReturnType<typeof createDrizzle>;

let preparedDatabase: TestDatabase | undefined;
let preparedDatabaseName: string | undefined;
let preparedDatabaseConfig: MySqlConfig | undefined;

afterAll(async () => {
  await disposeDatabase();
});

async function prepareDatabase(): Promise<Database> {
  if (preparedDatabase) {
    await cleanDatabase(preparedDatabase);
    return preparedDatabase;
  }

  const database = `test_${generateId({ length: 15 })}`;
  const config = inject("mysql");

  const connection = await createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
  });

  try {
    try {
      await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
      preparedDatabaseName = database;
      preparedDatabaseConfig = config;
    } finally {
      await connection.end();
    }

    const uri = `mysql://${config.user}:${config.password}@${config.host}:${config.port}/${database}`;
    const db = createDrizzle(uri);
    try {
      await migrate(db, {
        migrationsFolder: "./src/db/migrations",
      });
    } catch (error) {
      await db.$client.promise().end();
      throw error;
    }

    preparedDatabase = db;
    return db;
  } catch (error) {
    await disposeDatabase();
    throw error;
  }
}

async function cleanDatabase(db: TestDatabase): Promise<void> {
  const connection = await db.$client.promise().getConnection();

  try {
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");

    for (const tableName of tableNames) {
      await connection.query("TRUNCATE TABLE ??", [tableName]);
    }
  } finally {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1").catch((error: unknown) => {
      connection.destroy();
      throw error;
    });
    connection.release();
  }
}

async function disposeDatabase(): Promise<void> {
  const database = preparedDatabaseName;
  const config = preparedDatabaseConfig;
  const databaseClient = preparedDatabase;

  preparedDatabase = undefined;
  preparedDatabaseName = undefined;
  preparedDatabaseConfig = undefined;

  try {
    if (databaseClient) {
      await databaseClient.$client.promise().end();
    }
  } finally {
    if (database && config) {
      const connection = await createConnection(config);

      try {
        await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
      } finally {
        await connection.end();
      }
    }
  }
}

export { prepareDatabase };
