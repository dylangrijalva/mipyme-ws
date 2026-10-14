import { sql } from "drizzle-orm";
import pino from "pino";
import type { CurrentUser } from "../../src/contracts/current-user.ts";
import type { Database } from "../../src/db/index.ts";
import { tables } from "../../src/db/schema.ts";
import { PurchaseFinder } from "../../src/finders/purchase-finder.ts";
import { generateId } from "../../src/utils/generate-id.ts";

async function seedPurchaseReads(db: Database, reader?: { merchantId: string; employeeId: string }) {
  const merchantId = reader?.merchantId ?? generateId({ model: "merchant" });
  const employeeId = reader?.employeeId ?? generateId({ model: "employee" });
  const otherMerchantId = generateId({ model: "merchant" });
  const otherEmployeeId = generateId({ model: "employee" });
  const locationId = generateId({ model: "location" });
  const inaccessibleLocationId = generateId({ model: "location" });
  const foreignLocationId = generateId({ model: "location" });
  const supplierId = generateId({ model: "supplier" });
  const otherSupplierId = generateId({ model: "supplier" });
  const foreignSupplierId = generateId({ model: "supplier" });
  const productId = generateId({ model: "product" });
  const variantId = generateId({ model: "variant" });
  const ids = [1, 2, 3, 4, 5].map(() => generateId({ model: "purchaseOrder" })).sort();
  const itemId = generateId({ model: "purchaseOrderItem" });
  if (!reader) {
    await db.insert(tables.merchant).values({ id: merchantId, name: "Straw Hat Pirates", country: "ni" });
    await db
      .insert(tables.employee)
      .values({ id: employeeId, merchantId, name: "Nami", isOwner: true, status: "enabled" });
  }
  await db.insert(tables.merchant).values({ id: otherMerchantId, name: "Heart Pirates", country: "ni" });
  await db.insert(tables.employee).values({
    id: otherEmployeeId,
    merchantId: otherMerchantId,
    name: "Trafalgar Law",
    isOwner: true,
    status: "enabled",
  });
  await db.insert(tables.location).values([
    { id: locationId, merchantId, name: "Water 7" },
    { id: inaccessibleLocationId, merchantId, name: "Dressrosa" },
    { id: foreignLocationId, merchantId: otherMerchantId, name: "Wano Country" },
  ]);
  await db.insert(tables.supplier).values([
    { id: supplierId, merchantId, name: "Baratie" },
    { id: otherSupplierId, merchantId, name: "Galley-La Company" },
    { id: foreignSupplierId, merchantId: otherMerchantId, name: "Heart Pirates" },
  ]);
  await db
    .insert(tables.product)
    .values({ id: productId, merchantId, name: "Mandarins", slug: productId, price: "20.00", unitCost: "10.00" });
  await db
    .insert(tables.variant)
    .values({ id: variantId, merchantId, productId, name: "Nami's crate", price: "20.00" });
  await db.insert(tables.purchaseOrder).values(
    ids.map((id, index) => ({
      id,
      merchantId: index === 4 ? otherMerchantId : merchantId,
      locationId: index === 4 ? foreignLocationId : index === 3 ? inaccessibleLocationId : locationId,
      createdById: index === 4 ? otherEmployeeId : employeeId,
      supplierId: index === 4 ? foreignSupplierId : index === 2 ? otherSupplierId : supplierId,
      transactionNumber: index + 1,
      status: index === 1 ? ("voided" as const) : ("fulfilled" as const),
      notes: index === 1 ? "Provisions for the Sunny" : null,
      createdAt:
        index >= 3
          ? sql`'2026-10-12 00:00:00.000000'`
          : index === 2
            ? sql`'2026-10-10 18:30:00.123455'`
            : sql`'2026-10-10 18:30:00.123456'`,
    })),
  );
  await db.insert(tables.purchaseOrderItem).values({
    id: itemId,
    merchantId,
    purchaseOrderId: ids[1],
    variantId,
    name: "Nami's crate",
    quantity: 2,
    price: "20.00",
    unitCost: "10.00",
  });
  const user: CurrentUser = {
    id: employeeId,
    employeeId,
    merchantId,
    email: "nami@strawhatpirates.example.com",
    accountType: "owner",
  };
  const dependencies = { db, user, logger: pino({ enabled: false }), purchaseFinder: new PurchaseFinder() };
  return {
    dependencies,
    ids,
    merchantId,
    otherMerchantId,
    employeeId,
    locationId,
    inaccessibleLocationId,
    foreignLocationId,
    supplierId,
    otherSupplierId,
    foreignSupplierId,
    productId,
    variantId,
    itemId,
  };
}

export { seedPurchaseReads };
