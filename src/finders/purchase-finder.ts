import { and, asc, eq } from "drizzle-orm";
import { Purchase } from "../contracts/purchase.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";

type Criteria = {
  merchantId: string;
  id: string;
};

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
      .where(and(eq(tables.purchaseOrder.merchantId, criteria.merchantId), eq(tables.purchaseOrder.id, criteria.id)))
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
}

export { PurchaseFinder };
