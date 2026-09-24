import { drizzle, MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "./schema.ts";

function createDrizzle(url: string) {
  return drizzle(url, { mode: "default", schema });
}

type DrizzleClient = MySql2Database<typeof schema>;

type Database = Omit<MySql2Database<typeof schema>, "$client">;

export { createDrizzle, type Database, type DrizzleClient };
