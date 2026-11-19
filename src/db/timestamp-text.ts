import { sql } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";

type DateColumn = AnyMySqlColumn<{ dataType: "date"; notNull: true }>;

// A JavaScript Date loses the last three digits of a MySQL DATETIME(6).
function timestampText(column: DateColumn) {
  return sql<string>`cast(${column} as char)`;
}

function matchesTimestamp(column: DateColumn, timestamp: string) {
  return sql`${column} = ${timestamp}`;
}

export { matchesTimestamp, timestampText };
