import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { CurrentUser } from "../../../src/contracts/current-user.ts";
import { SalePaginationRequest } from "../../../src/contracts/sale-pagination-query.ts";
import { tables } from "../../../src/db/schema.ts";
import { SaleFinder } from "../../../src/finders/sale-finder.ts";
import { ListSalesService } from "../../../src/services/sales/list-sales-service.ts";
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
    { id: employeeId, merchantId, name: "Nami", isOwner: true, status: "enabled", pin: "4821" },
    {
      id: otherEmployeeId,
      merchantId: otherMerchantId,
      name: "Trafalgar Law",
      isOwner: true,
      status: "enabled",
      pin: "4821",
    },
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

describe("ListSalesService", () => {
  it("paginates newest first through timestamp ties and microseconds, excludes foreign sales, and returns full records", async () => {
    const context = await setup();
    const service = ListSalesService.create(context.dependencies);
    const pages = [];
    const ids: Array<string> = [];
    const first = await service.execute(SalePaginationRequest.parse({ limit: 1 }));
    expect(first.success).toBe(true);
    if (!first.success) {
      return;
    }
    pages.push(first.value);
    ids.push(...first.value.results.map((sale) => sale.id));

    for (const expectedId of [context.ids[1], context.ids[0], context.ids[2]]) {
      const previous = pages[pages.length - 1];
      expect(previous.hasMore).toBe(true);
      expect(previous.nextCursor).toEqual(expect.any(String));
      const next = await service.execute(SalePaginationRequest.parse({ limit: 1, cursor: previous.nextCursor }));
      expect(next.success).toBe(true);
      if (!next.success) {
        return;
      }
      expect(next.value.results.map((sale) => sale.id)).toEqual([expectedId]);
      pages.push(next.value);
      ids.push(...next.value.results.map((sale) => sale.id));
    }

    expect(ids).toEqual([context.ids[3], context.ids[1], context.ids[0], context.ids[2]]);
    expect(pages[1].results[0]).toMatchObject({
      status: "voided",
      customer: { id: context.customerId },
      createdBy: { id: context.employeeId },
      voidedBy: { id: context.employeeId },
      voidReason: "Nami corrected the order",
      lineItems: [{ id: context.itemId, quantity: 2 }],
      payments: [{ id: context.paymentId, amount: "40.00" }],
    });
    expect(pages[3]).toMatchObject({ hasMore: false, nextCursor: null });

    const combined = await service.execute({ limit: 50 });
    expect(combined.success).toBe(true);
    if (!combined.success) {
      return;
    }
    expect(
      combined.value.results.map((sale) => ({
        id: sale.id,
        items: sale.lineItems.map((item) => item.id),
        payments: sale.payments.map((payment) => payment.id),
      })),
    ).toEqual([
      { id: context.ids[3], items: [], payments: [] },
      { id: context.ids[1], items: [context.itemId], payments: [context.paymentId] },
      { id: context.ids[0], items: [], payments: [] },
      { id: context.ids[2], items: [], payments: [] },
    ]);
  });

  it("applies each filter and combines inclusive UTC-normalized business date bounds", async () => {
    const context = await setup();
    const service = ListSalesService.create(context.dependencies);
    const cases = [
      { query: { locationId: context.inaccessibleLocationId }, ids: [context.ids[3]] },
      { query: { status: "pending" }, ids: [context.ids[2]] },
      { query: { customerId: context.customerId }, ids: [context.ids[1], context.ids[0]] },
      { query: { from: "2026-10-11T18:30:00Z" }, ids: [context.ids[3], context.ids[2]] },
      { query: { to: "2026-10-10T12:30:00-06:00" }, ids: [context.ids[1], context.ids[0]] },
      {
        query: {
          locationId: context.locationId,
          status: "voided",
          customerId: context.customerId,
          from: "2026-10-10T12:30:00-06:00",
          to: "2026-10-10T18:30:00Z",
        },
        ids: [context.ids[1]],
      },
      { query: { locationId: context.foreignLocationId }, ids: [] },
    ];

    for (const scenario of cases) {
      const result = await service.execute(SalePaginationRequest.parse(scenario.query));

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }
      expect(result.value.results.map((sale) => sale.id)).toEqual(scenario.ids);
      expect(result.value).toMatchObject({ nextCursor: null, hasMore: false });
    }
  });

  it("limits permitted staff to assigned locations, including filtered requests, and rejects missing permission", async () => {
    const context = await setup();
    await context.db
      .update(tables.employee)
      .set({ isOwner: false, permissions: "view_transactions" })
      .where(eq(tables.employee.id, context.employeeId));
    const service = ListSalesService.create({
      ...context.dependencies,
      user: { ...context.user, accountType: "staff" },
    });

    const noAccess = await service.execute({ limit: 50 });
    expect(noAccess).toEqual({ success: true, value: { results: [], nextCursor: null, hasMore: false } });
    await context.db.insert(tables.locationAccess).values({
      id: generateId({ model: "locationAccess" }),
      merchantId: context.merchantId,
      employeeId: context.employeeId,
      locationId: context.locationId,
    });
    const allowed = await service.execute({ limit: 50 });
    const hidden = await service.execute({ limit: 50, locationId: context.inaccessibleLocationId });

    expect(allowed.success).toBe(true);
    if (!allowed.success) {
      return;
    }
    expect(allowed.value.results.map((sale) => sale.id)).toEqual([context.ids[1], context.ids[0], context.ids[2]]);
    expect(hidden).toEqual({ success: true, value: { results: [], nextCursor: null, hasMore: false } });

    await context.db
      .update(tables.employee)
      .set({ permissions: "checkout" })
      .where(eq(tables.employee.id, context.employeeId));
    const forbidden = await service.execute({ limit: 50 });
    expect(forbidden).toMatchObject({ success: false, error: { code: "forbidden_error" } });
  });
});
