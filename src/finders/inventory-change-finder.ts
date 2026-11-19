import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { InventoryChange } from "../contracts/inventory-change.ts";
import type { InventoryChangePaginationRequest } from "../contracts/inventory-change-pagination-query.ts";
import type { PaginationResponse } from "../contracts/pagination-response.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";

type Criteria = InventoryChangePaginationRequest & {
  merchantId: string;
  // Limits the history to the locations this employee has access to.
  employeeId?: string;
};

type MovementPosition = {
  id: string;
  inventoryLevelId: string;
  occurredAt: string;
};

class InventoryChangeFinder {
  async paginate(db: Database, criteria: Criteria): Promise<PaginationResponse<InventoryChange>> {
    const records = await db
      .select({
        movement: tables.inventoryMovement,
        variantId: tables.inventoryLevel.variantId,
        locationId: tables.inventoryLevel.locationId,
        createdBy: { id: tables.employee.id, name: tables.employee.name },
        cursorTimestamp: sql<string>`date_format(${tables.inventoryMovement.occurredAt}, '%Y-%m-%dT%H:%i:%s.%fZ')`,
      })
      .from(tables.inventoryMovement)
      .innerJoin(
        tables.inventoryLevel,
        and(
          eq(tables.inventoryLevel.merchantId, criteria.merchantId),
          eq(tables.inventoryLevel.id, tables.inventoryMovement.inventoryLevelId),
        ),
      )
      .innerJoin(
        tables.employee,
        and(
          eq(tables.employee.merchantId, criteria.merchantId),
          eq(tables.employee.id, tables.inventoryMovement.createdById),
        ),
      )
      .where(this.where(criteria))
      .orderBy(desc(tables.inventoryMovement.occurredAt), desc(tables.inventoryMovement.id))
      .limit(criteria.limit + 1);

    const hasMore = records.length > criteria.limit;
    const page = records.slice(0, criteria.limit);
    if (page.length === 0) {
      return { results: [], nextCursor: null, hasMore: false };
    }

    const onHandAfterByMovementId = await this.findOnHandAfter(
      db,
      criteria.merchantId,
      page.map((record) => ({
        id: record.movement.id,
        inventoryLevelId: record.movement.inventoryLevelId,
        occurredAt: toDatabaseTimestamp(record.cursorTimestamp),
      })),
    );

    const results = page.map((record) =>
      InventoryChange.parse({
        ...record.movement,
        type: "movement",
        variantId: record.variantId,
        locationId: record.locationId,
        createdBy: record.createdBy,
        onHandAfter: onHandAfterByMovementId.get(record.movement.id),
      }),
    );

    const last = page[page.length - 1];
    const nextCursor = hasMore
      ? Buffer.from(`${last.cursorTimestamp}|${last.movement.id}`).toString("base64url")
      : null;

    return { results, nextCursor, hasMore };
  }

  private where(criteria: Criteria) {
    return and(
      eq(tables.inventoryMovement.merchantId, criteria.merchantId),
      criteria.employeeId !== undefined
        ? sql`exists (select 1 from ${tables.locationAccess} where
          ${tables.locationAccess.merchantId} = ${criteria.merchantId}
          and ${tables.locationAccess.employeeId} = ${criteria.employeeId}
          and ${tables.locationAccess.locationId} = ${tables.inventoryLevel.locationId})`
        : undefined,
      criteria.variantIds !== undefined ? inArray(tables.inventoryLevel.variantId, criteria.variantIds) : undefined,
      criteria.locationIds !== undefined ? inArray(tables.inventoryLevel.locationId, criteria.locationIds) : undefined,
      criteria.reasons !== undefined ? inArray(tables.inventoryMovement.reason, criteria.reasons) : undefined,
      criteria.createdByIds !== undefined
        ? inArray(tables.inventoryMovement.createdById, criteria.createdByIds)
        : undefined,
      criteria.from !== undefined ? sql`${tables.inventoryMovement.occurredAt} >= ${criteria.from}` : undefined,
      criteria.to !== undefined ? sql`${tables.inventoryMovement.occurredAt} <= ${criteria.to}` : undefined,
      criteria.cursor !== undefined
        ? sql`(${tables.inventoryMovement.occurredAt} < ${criteria.cursor.occurredAt}
          or (${tables.inventoryMovement.occurredAt} = ${criteria.cursor.occurredAt}
          and ${tables.inventoryMovement.id} < ${criteria.cursor.id}))`
        : undefined,
    );
  }

  // Every on-hand change records a movement, so a level's on-hand after a movement is its current on-hand minus
  // the deltas recorded after it. Working back from the present only reads movements newer than the page,
  // regardless of how much older history exists, and ignores the request filters so balances stay exact.
  private async findOnHandAfter(
    db: Database,
    merchantId: string,
    page: Array<MovementPosition>,
  ): Promise<Map<string, number>> {
    const oldestByLevelId = new Map<string, MovementPosition>();
    for (const position of page) {
      oldestByLevelId.set(position.inventoryLevelId, position);
    }

    const newerThanOldest = [...oldestByLevelId.values()].map((oldest) =>
      and(
        eq(tables.inventoryMovement.inventoryLevelId, oldest.inventoryLevelId),
        or(
          sql`${tables.inventoryMovement.occurredAt} > ${oldest.occurredAt}`,
          and(
            sql`${tables.inventoryMovement.occurredAt} = ${oldest.occurredAt}`,
            gte(tables.inventoryMovement.id, oldest.id),
          ),
        ),
      ),
    );

    const balances = await db
      .select({
        id: tables.inventoryMovement.id,
        onHandAfter:
          sql<number>`${tables.inventoryLevel.onHand} - coalesce(sum(${tables.inventoryMovement.quantityDelta}) over (
          partition by ${tables.inventoryMovement.inventoryLevelId}
          order by ${tables.inventoryMovement.occurredAt} desc, ${tables.inventoryMovement.id} desc
          rows between unbounded preceding and 1 preceding
        ), 0)`.mapWith(Number),
      })
      .from(tables.inventoryMovement)
      .innerJoin(
        tables.inventoryLevel,
        and(
          eq(tables.inventoryLevel.merchantId, merchantId),
          eq(tables.inventoryLevel.id, tables.inventoryMovement.inventoryLevelId),
        ),
      )
      .where(or(...newerThanOldest));

    return new Map(balances.map((balance) => [balance.id, balance.onHandAfter]));
  }
}

function toDatabaseTimestamp(cursorTimestamp: string): string {
  return cursorTimestamp.replace("T", " ").replace("Z", "");
}

export { InventoryChangeFinder };
