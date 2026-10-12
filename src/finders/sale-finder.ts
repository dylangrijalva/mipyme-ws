import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { Sale } from "../contracts/sale.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";

type Criteria = { merchantId: string; id: string };

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
      .where(and(eq(tables.sale.id, criteria.id), eq(tables.sale.merchantId, criteria.merchantId)))
      .limit(1);
    if (!record) return null;

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
}

export { SaleFinder };
