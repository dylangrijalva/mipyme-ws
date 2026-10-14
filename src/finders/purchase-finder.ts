import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Purchase } from "../contracts/purchase.ts";
import type { PaginationResponse } from "../contracts/pagination-response.ts";
import type { PurchasePaginationRequest } from "../contracts/purchase-pagination-query.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";

type Criteria = {
  merchantId: string;
  id: string;
  employeeId?: string;
};

type PaginationCriteria = PurchasePaginationRequest & { merchantId: string; employeeId?: string };

function locationAccessCondition(criteria: { merchantId: string; employeeId?: string }) {
  if (criteria.employeeId === undefined) return undefined;
  return sql`exists (select 1 from ${tables.locationAccess} where
    ${tables.locationAccess.merchantId} = ${criteria.merchantId}
    and ${tables.locationAccess.employeeId} = ${criteria.employeeId}
    and ${tables.locationAccess.locationId} = ${tables.purchaseOrder.locationId})`;
}

class PurchaseFinder {
  async find(db: Database, criteria: Criteria): Promise<Purchase | null> {
    const [record] = await db
      .select({
        purchaseOrder: tables.purchaseOrder,
        supplier: tables.supplier,
        createdBy: tables.employee,
      })
      .from(tables.purchaseOrder)
      .innerJoin(
        tables.supplier,
        and(
          eq(tables.supplier.merchantId, criteria.merchantId),
          eq(tables.supplier.id, tables.purchaseOrder.supplierId),
        ),
      )
      .leftJoin(
        tables.employee,
        and(
          eq(tables.employee.merchantId, criteria.merchantId),
          eq(tables.employee.id, tables.purchaseOrder.createdById),
        ),
      )
      .where(
        and(
          eq(tables.purchaseOrder.merchantId, criteria.merchantId),
          eq(tables.purchaseOrder.id, criteria.id),
          locationAccessCondition(criteria),
        ),
      )
      .limit(1);

    if (!record) {
      return null;
    }

    const items = await db
      .select({
        id: tables.purchaseOrderItem.id,
        name: tables.purchaseOrderItem.name,
        quantity: tables.purchaseOrderItem.quantity,
        price: tables.purchaseOrderItem.price,
        unitCost: tables.purchaseOrderItem.unitCost,
        variantId: tables.purchaseOrderItem.variantId,
      })
      .from(tables.purchaseOrderItem)
      .where(
        and(
          eq(tables.purchaseOrderItem.merchantId, criteria.merchantId),
          eq(tables.purchaseOrderItem.purchaseOrderId, criteria.id),
        ),
      )
      .orderBy(asc(tables.purchaseOrderItem.id));

    return Purchase.parse({
      ...record.purchaseOrder,
      supplier: {
        id: record.supplier.id,
        name: record.supplier.name,
      },
      lineItems: items.map((item) => ({
        id: item.id,
        unitCost: item.unitCost,
        price: item.price,
        variants: [{ id: item.variantId, name: item.name, quantity: item.quantity }],
      })),
      createdBy: record.createdBy ? { id: record.createdBy.id, name: record.createdBy.name } : null,
    });
  }

  async paginate(db: Database, criteria: PaginationCriteria): Promise<PaginationResponse<Purchase>> {
    const records = await db
      .select({
        purchaseOrder: tables.purchaseOrder,
        supplier: tables.supplier,
        createdBy: tables.employee,
        // Keep microseconds for cursor comparisons; JavaScript Date truncates them.
        cursorTimestamp: sql<string>`date_format(${tables.purchaseOrder.createdAt}, '%Y-%m-%dT%H:%i:%s.%fZ')`,
      })
      .from(tables.purchaseOrder)
      .innerJoin(
        tables.supplier,
        and(
          eq(tables.supplier.merchantId, criteria.merchantId),
          eq(tables.supplier.id, tables.purchaseOrder.supplierId),
        ),
      )
      .leftJoin(
        tables.employee,
        and(
          eq(tables.employee.merchantId, criteria.merchantId),
          eq(tables.employee.id, tables.purchaseOrder.createdById),
        ),
      )
      .where(
        and(
          eq(tables.purchaseOrder.merchantId, criteria.merchantId),
          locationAccessCondition(criteria),
          criteria.locationId !== undefined ? eq(tables.purchaseOrder.locationId, criteria.locationId) : undefined,
          criteria.status !== undefined ? eq(tables.purchaseOrder.status, criteria.status) : undefined,
          criteria.supplierId !== undefined ? eq(tables.purchaseOrder.supplierId, criteria.supplierId) : undefined,
          criteria.from !== undefined ? sql`${tables.purchaseOrder.createdAt} >= ${criteria.from}` : undefined,
          criteria.to !== undefined ? sql`${tables.purchaseOrder.createdAt} <= ${criteria.to}` : undefined,
          criteria.cursor !== undefined
            ? sql`(${tables.purchaseOrder.createdAt} < ${criteria.cursor.createdAt}
          or (${tables.purchaseOrder.createdAt} = ${criteria.cursor.createdAt} and ${tables.purchaseOrder.id} < ${criteria.cursor.id}))`
            : undefined,
        ),
      )
      .orderBy(desc(tables.purchaseOrder.createdAt), desc(tables.purchaseOrder.id))
      .limit(criteria.limit + 1);

    const hasMore = records.length > criteria.limit;
    const page = records.slice(0, criteria.limit);
    if (page.length === 0) return { results: [], nextCursor: null, hasMore: false };
    const purchaseIds = page.map((record) => record.purchaseOrder.id);
    const items = await db
      .select()
      .from(tables.purchaseOrderItem)
      .where(
        and(
          eq(tables.purchaseOrderItem.merchantId, criteria.merchantId),
          inArray(tables.purchaseOrderItem.purchaseOrderId, purchaseIds),
        ),
      )
      .orderBy(asc(tables.purchaseOrderItem.id));
    const results = page.map((record) =>
      Purchase.parse({
        ...record.purchaseOrder,
        supplier: { id: record.supplier.id, name: record.supplier.name },
        createdBy: record.createdBy ? { id: record.createdBy.id, name: record.createdBy.name } : null,
        lineItems: items
          .filter((item) => item.purchaseOrderId === record.purchaseOrder.id)
          .map((item) => ({
            id: item.id,
            unitCost: item.unitCost,
            price: item.price,
            variants: [{ id: item.variantId, name: item.name, quantity: item.quantity }],
          })),
      }),
    );
    const last = page[page.length - 1];
    const nextCursor = hasMore
      ? Buffer.from(`${last.cursorTimestamp}|${last.purchaseOrder.id}`).toString("base64url")
      : null;
    return { results, nextCursor, hasMore };
  }
}

export { PurchaseFinder };
