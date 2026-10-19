import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import type { PaginationResponse } from "../contracts/pagination-response.ts";
import type { SalePaginationRequest } from "../contracts/sale-pagination-query.ts";
import { Sale } from "../contracts/sale.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";

type Criteria = {
  merchantId: string;
  id: string;
  employeeId?: string;
};

type PaginationCriteria = SalePaginationRequest & {
  merchantId: string;
  employeeId?: string;
};

function locationAccessCondition(criteria: { merchantId: string; employeeId?: string }) {
  if (criteria.employeeId === undefined) {
    return undefined;
  }
  return sql`exists (select 1 from ${tables.locationAccess} where
    ${tables.locationAccess.merchantId} = ${criteria.merchantId}
    and ${tables.locationAccess.employeeId} = ${criteria.employeeId}
    and ${tables.locationAccess.locationId} = ${tables.sale.locationId})`;
}

class SaleFinder {
  async find(db: Database, criteria: Criteria): Promise<Sale | null> {
    const voidedBy = alias(tables.employee, "voided_by");
    const [record] = await db
      .select({ sale: tables.sale, customer: tables.customer, createdBy: tables.employee, voidedBy })
      .from(tables.sale)
      .leftJoin(
        tables.customer,
        and(eq(tables.customer.id, tables.sale.customerId), eq(tables.customer.merchantId, criteria.merchantId)),
      )
      .leftJoin(
        tables.employee,
        and(eq(tables.employee.id, tables.sale.createdById), eq(tables.employee.merchantId, criteria.merchantId)),
      )
      .leftJoin(voidedBy, and(eq(voidedBy.id, tables.sale.voidedById), eq(voidedBy.merchantId, criteria.merchantId)))
      .where(
        and(
          eq(tables.sale.id, criteria.id),
          eq(tables.sale.merchantId, criteria.merchantId),
          locationAccessCondition(criteria),
        ),
      )
      .limit(1);
    if (!record) {
      return null;
    }

    const lineItems = await db
      .select()
      .from(tables.saleItem)
      .where(and(eq(tables.saleItem.saleId, criteria.id), eq(tables.saleItem.merchantId, criteria.merchantId)))
      .orderBy(asc(tables.saleItem.id));
    const payments = await db
      .select()
      .from(tables.salePayment)
      .where(and(eq(tables.salePayment.saleId, criteria.id), eq(tables.salePayment.merchantId, criteria.merchantId)))
      .orderBy(asc(tables.salePayment.id));
    return Sale.parse({
      ...record.sale,
      lineItems,
      payments,
      customer: record.customer ? { id: record.customer.id, name: record.customer.name } : null,
      createdBy: record.createdBy ? { id: record.createdBy.id, name: record.createdBy.name } : null,
      voidedBy: record.voidedBy ? { id: record.voidedBy.id, name: record.voidedBy.name } : null,
    });
  }

  async paginate(db: Database, criteria: PaginationCriteria): Promise<PaginationResponse<Sale>> {
    const voidedBy = alias(tables.employee, "voided_by");
    const records = await db
      .select({
        sale: tables.sale,
        customer: tables.customer,
        createdBy: tables.employee,
        voidedBy,
        cursorTimestamp: sql<string>`date_format(${tables.sale.createdAt}, '%Y-%m-%dT%H:%i:%s.%fZ')`,
      })
      .from(tables.sale)
      .leftJoin(
        tables.customer,
        and(eq(tables.customer.id, tables.sale.customerId), eq(tables.customer.merchantId, criteria.merchantId)),
      )
      .leftJoin(
        tables.employee,
        and(eq(tables.employee.id, tables.sale.createdById), eq(tables.employee.merchantId, criteria.merchantId)),
      )
      .leftJoin(voidedBy, and(eq(voidedBy.id, tables.sale.voidedById), eq(voidedBy.merchantId, criteria.merchantId)))
      .where(
        and(
          eq(tables.sale.merchantId, criteria.merchantId),
          locationAccessCondition(criteria),
          criteria.locationId !== undefined ? eq(tables.sale.locationId, criteria.locationId) : undefined,
          criteria.status !== undefined ? eq(tables.sale.status, criteria.status) : undefined,
          criteria.customerId !== undefined ? eq(tables.sale.customerId, criteria.customerId) : undefined,
          criteria.from !== undefined ? gte(tables.sale.businessDate, criteria.from) : undefined,
          criteria.to !== undefined ? lte(tables.sale.businessDate, criteria.to) : undefined,
          criteria.cursor !== undefined
            ? sql`(${tables.sale.createdAt} < ${criteria.cursor.createdAt}
          or (${tables.sale.createdAt} = ${criteria.cursor.createdAt} and ${tables.sale.id} < ${criteria.cursor.id}))`
            : undefined,
        ),
      )
      .orderBy(desc(tables.sale.createdAt), desc(tables.sale.id))
      .limit(criteria.limit + 1);

    const hasMore = records.length > criteria.limit;
    const page = records.slice(0, criteria.limit);
    if (page.length === 0) {
      return { results: [], nextCursor: null, hasMore: false };
    }
    const saleIds = page.map((record) => record.sale.id);
    const [lineItems, payments] = await Promise.all([
      db
        .select()
        .from(tables.saleItem)
        .where(and(eq(tables.saleItem.merchantId, criteria.merchantId), inArray(tables.saleItem.saleId, saleIds)))
        .orderBy(asc(tables.saleItem.id)),
      db
        .select()
        .from(tables.salePayment)
        .where(and(eq(tables.salePayment.merchantId, criteria.merchantId), inArray(tables.salePayment.saleId, saleIds)))
        .orderBy(asc(tables.salePayment.id)),
    ]);
    const results = page.map((record) =>
      Sale.parse({
        ...record.sale,
        lineItems: lineItems.filter((item) => item.saleId === record.sale.id),
        payments: payments.filter((payment) => payment.saleId === record.sale.id),
        customer: record.customer ? { id: record.customer.id, name: record.customer.name } : null,
        createdBy: record.createdBy ? { id: record.createdBy.id, name: record.createdBy.name } : null,
        voidedBy: record.voidedBy ? { id: record.voidedBy.id, name: record.voidedBy.name } : null,
      }),
    );
    const last = page[page.length - 1];
    const nextCursor = hasMore ? Buffer.from(`${last.cursorTimestamp}|${last.sale.id}`).toString("base64url") : null;
    return { results, nextCursor, hasMore };
  }
}

export { SaleFinder };
