import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import type { CurrentUser } from "../../../src/contracts/current-user.ts";
import { tables } from "../../../src/db/schema.ts";
import { SaleFinder } from "../../../src/finders/sale-finder.ts";
import { FindSaleService } from "../../../src/services/sales/find-sale-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";

async function setup() {
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

describe("FindSaleService", () => {
  it("returns a full voided sale with its original payment and related people without changing it", async () => {
    const context = await setup();
    const before = await context.db.select().from(tables.sale);
    const service = FindSaleService.create(context.dependencies);

    const result = await service.execute(context.ids[1]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value).toMatchObject({
      id: context.ids[1],
      status: "voided",
      businessDate: context.businessDate,
      customer: { id: context.customerId, name: "Monkey D. Luffy" },
      createdBy: { id: context.employeeId, name: "Nami" },
      voidedBy: { id: context.employeeId, name: "Nami" },
      voidReason: "Nami corrected the order",
      voidedAt: context.businessDate,
      lineItems: [
        {
          id: context.itemId,
          variantId: context.variantId,
          name: "Nami's crate",
          quantity: 2,
          price: "20.00",
          unitCost: "10.00",
          shortageQuantity: 1,
        },
      ],
      payments: [{ id: context.paymentId, method: "cash", amount: "40.00", exchangeRate: null }],
    });
    expect(await context.db.select().from(tables.sale)).toEqual(before);
  });

  it("returns not found for missing and foreign sales", async () => {
    const context = await setup();
    const service = FindSaleService.create(context.dependencies);

    for (const id of [generateId({ model: "sale" }), context.ids[4]]) {
      const result = await service.execute(id);

      expect(result).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    }
  });

  it("lets permitted staff read assigned locations and hides other locations", async () => {
    const context = await setup();
    await context.db
      .update(tables.employee)
      .set({ isOwner: false, permissions: "view_transactions" })
      .where(eq(tables.employee.id, context.employeeId));
    await context.db.insert(tables.locationAccess).values({
      id: generateId({ model: "locationAccess" }),
      merchantId: context.merchantId,
      employeeId: context.employeeId,
      locationId: context.locationId,
    });
    const service = FindSaleService.create({
      ...context.dependencies,
      user: { ...context.user, accountType: "staff" },
    });

    const allowed = await service.execute(context.ids[0]);
    const hidden = await service.execute(context.ids[3]);

    expect(allowed).toMatchObject({
      success: true,
      value: { id: context.ids[0], lineItems: [], payments: [], voidedBy: null },
    });
    expect(hidden).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
  });

  it.each([
    { status: "enabled" as const, permissions: "checkout", isOwner: false },
    { status: "disabled" as const, permissions: "view_transactions", isOwner: false },
    { status: "disabled" as const, permissions: "", isOwner: true },
  ])("rejects a reader with $status access, owner=$isOwner, and permissions=$permissions", async (employee) => {
    const context = await setup();
    await context.db.update(tables.employee).set(employee).where(eq(tables.employee.id, context.employeeId));
    const service = FindSaleService.create(context.dependencies);

    const result = await service.execute(context.ids[0]);

    expect(result).toMatchObject({ success: false, error: { code: codes.forbiddenError } });
  });
});
