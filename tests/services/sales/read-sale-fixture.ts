import { sql } from "drizzle-orm";
import pino from "pino";
import type { CurrentUser } from "../../../src/contracts/current-user.ts";
import { tables } from "../../../src/db/schema.ts";
import { SaleFinder } from "../../../src/finders/sale-finder.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";

async function prepareSaleReads() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  const employeeId = generateId({ model: "employee" });
  const otherEmployeeId = generateId({ model: "employee" });
  const locationId = generateId({ model: "location" });
  const inaccessibleLocationId = generateId({ model: "location" });
  const foreignLocationId = generateId({ model: "location" });
  const customerId = generateId({ model: "customer" });
  const productId = generateId({ model: "product" });
  const variantId = generateId({ model: "variant" });
  const ids = [1, 2, 3, 4, 5].map((number) => `sale_${String(number).padStart(19, "0")}`);
  const businessDate = new Date("2026-10-10T18:30:00.000Z");
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  await db.insert(tables.employee).values([
    { id: employeeId, merchantId, name: "Nami", isOwner: true, status: "enabled" },
    { id: otherEmployeeId, merchantId: otherMerchantId, name: "Trafalgar Law", isOwner: true, status: "enabled" },
  ]);
  await db.insert(tables.location).values([
    { id: locationId, merchantId, name: "Water 7" },
    { id: inaccessibleLocationId, merchantId, name: "Dressrosa" },
    { id: foreignLocationId, merchantId: otherMerchantId, name: "Wano Country" },
  ]);
  await db.insert(tables.customer).values({ id: customerId, merchantId, name: "Monkey D. Luffy" });
  await db
    .insert(tables.product)
    .values({ id: productId, merchantId, name: "Mandarins", slug: "mandarins", price: "20.00", unitCost: "10.00" });
  await db
    .insert(tables.variant)
    .values({ id: variantId, merchantId, productId, name: "Nami's crate", price: "20.00" });
  await db.insert(tables.sale).values(
    ids.map((id, index) => ({
      id,
      merchantId: index === 4 ? otherMerchantId : merchantId,
      locationId: index === 4 ? foreignLocationId : index === 3 ? inaccessibleLocationId : locationId,
      createdById: index === 4 ? otherEmployeeId : employeeId,
      transactionNumber: index + 1,
      source: "pos.web" as const,
      status: index === 1 ? ("voided" as const) : index === 2 ? ("pending" as const) : ("fulfilled" as const),
      customerId: index === 0 || index === 1 ? customerId : null,
      businessDate: index === 0 || index === 1 ? businessDate : new Date("2026-10-11T18:30:00.000Z"),
      createdAt: index >= 3 ? new Date("2026-10-12T00:00:00.000Z") : sql`'2026-10-10 18:30:00.123456'`,
      voidedById: index === 1 ? employeeId : null,
      voidedAt: index === 1 ? businessDate : null,
      voidReason: index === 1 ? "Nami corrected the order" : null,
    })),
  );
  // This row differs only below millisecond precision and must remain reachable.
  await db.execute(
    sql`update ${tables.sale} set ${tables.sale.createdAt} = '2026-10-10 18:30:00.123455' where ${tables.sale.id} = ${ids[2]}`,
  );
  const itemId = generateId({ model: "saleItem" });
  const paymentId = generateId({ model: "salePayment" });
  await db.insert(tables.saleItem).values({
    id: itemId,
    merchantId,
    saleId: ids[1],
    variantId,
    name: "Nami's crate",
    quantity: 2,
    price: "20.00",
    unitCost: "10.00",
    shortageQuantity: 1,
  });
  await db
    .insert(tables.salePayment)
    .values({ id: paymentId, merchantId, saleId: ids[1], method: "cash", amount: "40.00" });
  const user: CurrentUser = {
    id: employeeId,
    employeeId,
    merchantId,
    email: "nami@strawhatpirates.example.com",
    accountType: "owner",
  };
  const dependencies = { db, user, logger: pino({ enabled: false }), saleFinder: new SaleFinder() };
  return {
    ...dependencies,
    dependencies,
    ids,
    locationId,
    inaccessibleLocationId,
    foreignLocationId,
    customerId,
    employeeId,
    merchantId,
    businessDate,
    itemId,
    paymentId,
    variantId,
  };
}

export { prepareSaleReads };
