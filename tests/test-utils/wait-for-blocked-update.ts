import { sql } from "drizzle-orm";
import { expect } from "vitest";
import type { Database } from "../../src/db/index.ts";

async function waitForBlockedUpdate<TResult>(
  db: Database,
  tableName: "products" | "locations",
  lockName: string,
  runConcurrentWork: () => Promise<TResult>,
): Promise<TResult> {
  const triggerName = `wait_for_${tableName}_update`;
  await db.execute(
    sql.raw(`
    CREATE TRIGGER ${triggerName} BEFORE UPDATE ON ${tableName}
    FOR EACH ROW BEGIN
      DO GET_LOCK('${lockName}', 10);
      DO RELEASE_LOCK('${lockName}');
    END
  `),
  );

  try {
    return await db.transaction(async (lock) => {
      const [acquiredLock] = await lock
        .select({ acquired: sql<number>`GET_LOCK(${lockName}, 10)`.mapWith(Number) })
        .from(sql`dual`);
      expect(acquiredLock.acquired).toBe(1);
      const attempts = runConcurrentWork();

      try {
        await expect
          .poll(
            async () => {
              const [namedLockWaits] = await db
                .select({ waiting: sql<number>`count(*)`.mapWith(Number) })
                .from(sql`performance_schema.metadata_locks`).where(sql`
                  OBJECT_TYPE = 'USER LEVEL LOCK'
                  AND OBJECT_NAME = ${lockName}
                  AND LOCK_STATUS = 'PENDING'
                `);
              const [rowLockWaits] = await db
                .select({ waiting: sql<number>`count(*)`.mapWith(Number) })
                .from(sql`performance_schema.data_lock_waits`)
                .innerJoin(
                  sql`performance_schema.data_locks`,
                  sql`
                    performance_schema.data_lock_waits.REQUESTING_ENGINE_LOCK_ID =
                    performance_schema.data_locks.ENGINE_LOCK_ID
                  `,
                ).where(sql`
                  performance_schema.data_locks.OBJECT_SCHEMA = DATABASE()
                  AND performance_schema.data_locks.OBJECT_NAME = ${tableName}
                  AND performance_schema.data_locks.INDEX_NAME = 'PRIMARY'
                `);

              return { namedLockWaits: namedLockWaits.waiting, rowLockWaits: rowLockWaits.waiting };
            },
            { timeout: 5_000 },
          )
          .toEqual({ namedLockWaits: 1, rowLockWaits: 1 });
      } finally {
        const [releasedLock] = await lock
          .select({ released: sql<number>`RELEASE_LOCK(${lockName})`.mapWith(Number) })
          .from(sql`dual`);
        expect(releasedLock.released).toBe(1);
        await attempts;
      }

      return attempts;
    });
  } finally {
    await db.execute(sql.raw(`DROP TRIGGER ${triggerName}`));
  }
}

export { waitForBlockedUpdate };
