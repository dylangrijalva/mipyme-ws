import { and, eq, gt, sql } from "drizzle-orm";
import { Location } from "../contracts/location.ts";
import type { ScopedPaginationRequest } from "../contracts/pagination-query.ts";
import type { PaginationResponse } from "../contracts/pagination-response.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";
import { paginate } from "../utils/paginate.ts";
import { type SyncCriteria, syncWindow } from "./sync-criteria.ts";

type Criteria = { merchantId: string; id: string; employeeId?: string };
type PaginationCriteria = ScopedPaginationRequest & { employeeId?: string };

function locationAccessCondition(criteria: { merchantId: string; employeeId?: string }) {
  if (criteria.employeeId === undefined) {
    return undefined;
  }
  return sql`exists (select 1 from ${tables.locationAccess} where
    ${tables.locationAccess.merchantId} = ${criteria.merchantId}
    and ${tables.locationAccess.employeeId} = ${criteria.employeeId}
    and ${tables.locationAccess.locationId} = ${tables.location.id})`;
}

class LocationFinder {
  async findForSync(db: Database, criteria: SyncCriteria): Promise<Array<Location>> {
    const records = await db
      .select()
      .from(tables.location)
      .where(and(eq(tables.location.merchantId, criteria.merchantId), syncWindow(tables.location.updatedAt, criteria)))
      .orderBy(tables.location.id);
    return records.map((record) => Location.parse(record));
  }

  async find(db: Database, criteria: Criteria): Promise<Location | null> {
    const [record] = await db
      .select()
      .from(tables.location)
      .where(
        and(
          eq(tables.location.merchantId, criteria.merchantId),
          eq(tables.location.id, criteria.id),
          locationAccessCondition(criteria),
        ),
      )
      .limit(1);
    return record ? Location.parse(record) : null;
  }

  async paginate(db: Database, criteria: PaginationCriteria): Promise<PaginationResponse<Location>> {
    const records = await db
      .select()
      .from(tables.location)
      .where(
        and(
          eq(tables.location.merchantId, criteria.merchantId),
          locationAccessCondition(criteria),
          criteria.cursor !== undefined ? gt(tables.location.id, criteria.cursor) : undefined,
        ),
      )
      .orderBy(tables.location.id)
      .limit(criteria.limit + 1);
    return paginate({ collection: records.map((record) => Location.parse(record)), limit: criteria.limit });
  }
}

export { LocationFinder };
