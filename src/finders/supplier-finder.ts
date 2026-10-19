import { and, eq, gt } from "drizzle-orm";
import type { ScopedPaginationRequest } from "../contracts/pagination-query.ts";
import type { PaginationResponse } from "../contracts/pagination-response.ts";
import { Supplier } from "../contracts/supplier.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";
import { paginate } from "../utils/paginate.ts";
import { type SyncCriteria, syncWindow } from "./sync-criteria.ts";

type Criteria = { merchantId: string; id: string };

class SupplierFinder {
  async findForSync(db: Database, criteria: SyncCriteria): Promise<Array<Supplier>> {
    const records = await db
      .select()
      .from(tables.supplier)
      .where(and(eq(tables.supplier.merchantId, criteria.merchantId), syncWindow(tables.supplier.updatedAt, criteria)))
      .orderBy(tables.supplier.id);
    return records.map((record) => Supplier.parse(record));
  }

  async find(db: Database, criteria: Criteria): Promise<Supplier | null> {
    const [record] = await db
      .select()
      .from(tables.supplier)
      .where(and(eq(tables.supplier.merchantId, criteria.merchantId), eq(tables.supplier.id, criteria.id)))
      .limit(1);
    return record ? Supplier.parse(record) : null;
  }

  async paginate(db: Database, criteria: ScopedPaginationRequest): Promise<PaginationResponse<Supplier>> {
    const records = await db
      .select()
      .from(tables.supplier)
      .where(
        and(
          eq(tables.supplier.merchantId, criteria.merchantId),
          criteria.cursor !== undefined ? gt(tables.supplier.id, criteria.cursor) : undefined,
        ),
      )
      .orderBy(tables.supplier.id)
      .limit(criteria.limit + 1);
    return paginate({ collection: records.map((record) => Supplier.parse(record)), limit: criteria.limit });
  }
}

export { SupplierFinder };
