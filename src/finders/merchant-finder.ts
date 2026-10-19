import { and, eq } from "drizzle-orm";
import { Merchant } from "../contracts/merchant.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";
import { type SyncCriteria, syncWindow } from "./sync-criteria.ts";

class MerchantFinder {
  async findForSync(db: Database, criteria: SyncCriteria): Promise<Merchant | null> {
    const [record] = await db
      .select()
      .from(tables.merchant)
      .where(and(eq(tables.merchant.id, criteria.merchantId), syncWindow(tables.merchant.updatedAt, criteria)))
      .limit(1);
    return record ? Merchant.parse(record) : null;
  }

  async find(db: Database, id: string): Promise<Merchant | null> {
    const [record] = await db
      .select({
        id: tables.merchant.id,
        name: tables.merchant.name,
        country: tables.merchant.country,
        createdAt: tables.merchant.createdAt,
        updatedAt: tables.merchant.updatedAt,
      })
      .from(tables.merchant)
      .where(eq(tables.merchant.id, id))
      .limit(1);

    return record ? Merchant.parse(record) : null;
  }
}

export { MerchantFinder };
