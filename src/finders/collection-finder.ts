import { and, eq, gt } from "drizzle-orm";
import { Collection } from "../contracts/collection.ts";
import type { ScopedPaginationRequest } from "../contracts/pagination-query.ts";
import type { PaginationResponse } from "../contracts/pagination-response.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";
import { paginate } from "../utils/paginate.ts";

type Criteria = {
  merchantId: string;
  id?: string;
  slug?: string;
};

class CollectionFinder {
  async find(db: Database, criteria: Criteria): Promise<Collection | null> {
    const [record] = await db
      .select()
      .from(tables.collection)
      .where(this.where(criteria))
      .orderBy(tables.collection.id)
      .limit(1);
    return record ? Collection.parse(record) : null;
  }

  async paginate(db: Database, criteria: ScopedPaginationRequest): Promise<PaginationResponse<Collection>> {
    const records = await db
      .select()
      .from(tables.collection)
      .where(
        and(
          eq(tables.collection.merchantId, criteria.merchantId),
          criteria.cursor !== undefined ? gt(tables.collection.id, criteria.cursor) : undefined,
        ),
      )
      .orderBy(tables.collection.id)
      .limit(criteria.limit + 1);
    return paginate({ collection: records.map((record) => Collection.parse(record)), limit: criteria.limit });
  }

  async exists(db: Database, criteria: Criteria): Promise<boolean> {
    const [record] = await db
      .select({ id: tables.collection.id })
      .from(tables.collection)
      .where(this.where(criteria))
      .limit(1);
    return record !== undefined;
  }

  private where(criteria: Criteria) {
    return and(
      eq(tables.collection.merchantId, criteria.merchantId),
      criteria.id !== undefined ? eq(tables.collection.id, criteria.id) : undefined,
      criteria.slug !== undefined ? eq(tables.collection.slug, criteria.slug) : undefined,
    );
  }
}

export { CollectionFinder };
