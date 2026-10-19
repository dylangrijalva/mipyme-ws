import { and, gte, lte } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";

type SyncCriteria = {
  merchantId: string;
  previousSyncedAt: Date | null;
  currentSyncedAt: Date;
};

function syncWindow(column: MySqlColumn, criteria: SyncCriteria) {
  if (criteria.previousSyncedAt === null) {
    return undefined;
  }
  return and(gte(column, criteria.previousSyncedAt), lte(column, criteria.currentSyncedAt));
}

export { type SyncCriteria, syncWindow };
