import { and, eq, gt } from "drizzle-orm";
import { Customer } from "../contracts/customer.ts";
import type { ScopedPaginationRequest } from "../contracts/pagination-query.ts";
import type { PaginationResponse } from "../contracts/pagination-response.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";
import { paginate } from "../utils/paginate.ts";

type Criteria = { merchantId: string; id: string };

class CustomerFinder {
  async find(db: Database, criteria: Criteria): Promise<Customer | null> {
    const [record] = await db
      .select()
      .from(tables.customer)
      .where(and(eq(tables.customer.merchantId, criteria.merchantId), eq(tables.customer.id, criteria.id)))
      .limit(1);
    return record ? Customer.parse(record) : null;
  }

  async paginate(db: Database, criteria: ScopedPaginationRequest): Promise<PaginationResponse<Customer>> {
    const records = await db
      .select()
      .from(tables.customer)
      .where(
        and(
          eq(tables.customer.merchantId, criteria.merchantId),
          criteria.cursor !== undefined ? gt(tables.customer.id, criteria.cursor) : undefined,
        ),
      )
      .orderBy(tables.customer.id)
      .limit(criteria.limit + 1);
    return paginate({ collection: records.map((record) => Customer.parse(record)), limit: criteria.limit });
  }
}

export { CustomerFinder };
