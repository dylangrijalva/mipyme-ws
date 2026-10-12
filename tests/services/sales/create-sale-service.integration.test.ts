import { and, eq, sql } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import type { CurrentUser } from "../../../src/contracts/current-user.ts";
import type { Database } from "../../../src/db/index.ts";
import { tables } from "../../../src/db/schema.ts";
import { PurchaseFinder } from "../../../src/finders/purchase-finder.ts";
import { SaleFinder } from "../../../src/finders/sale-finder.ts";
import { CreatePurchaseService } from "../../../src/services/purchases/create-purchase-service.ts";
import { CreateSaleRequest, CreateSaleService } from "../../../src/services/sales/create-sale-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import { waitForBlockedUpdate } from "../../utils/wait-for-blocked-update.ts";

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const employeeId = generateId({ model: "employee" });
  const locationId = generateId({ model: "location" });
  const otherLocationId = generateId({ model: "location" });
  const productId = generateId({ model: "product" });
  const variantId = generateId({ model: "variant" });
  const serviceProductId = generateId({ model: "product" });
  const serviceVariantId = generateId({ model: "variant" });
  const customerId = generateId({ model: "customer" });
  await db.insert(tables.merchant).values({ id: merchantId, name: "Straw Hat Pirates" });
  await db
    .insert(tables.employee)
    .values({ id: employeeId, merchantId, name: "Nami", isOwner: true, status: "enabled" });
  await db.insert(tables.location).values([
    { id: locationId, merchantId, name: "Water 7", exchangeRate: "36.50", nextSaleNumber: 42 },
    { id: otherLocationId, merchantId, name: "Dressrosa" },
  ]);
  await db.insert(tables.product).values([
    {
      id: productId,
      merchantId,
      name: "Nami's mandarins",
      slug: "mandarins",
      price: "100.00",
      unitCost: "50.00",
      status: "active",
      type: "item",
    },
    {
      id: serviceProductId,
      merchantId,
      name: "Chopper's consultation",
      slug: "consultation",
      price: "20.00",
      unitCost: "0.00",
      status: "active",
      type: "service",
    },
  ]);
  await db.insert(tables.variant).values([
    { id: variantId, merchantId, productId, name: "Mandarin crate", price: "100.00" },
    { id: serviceVariantId, merchantId, productId: serviceProductId, name: "Consultation", price: "20.00" },
  ]);
  await db.insert(tables.inventoryLevel).values([
    { id: generateId({ model: "inventoryLevel" }), merchantId, locationId, variantId, onHand: 5 },
    { id: generateId({ model: "inventoryLevel" }), merchantId, locationId: otherLocationId, variantId, onHand: 7 },
  ]);
  await db.insert(tables.customer).values({ id: customerId, merchantId, name: "Monkey D. Luffy" });
  const user: CurrentUser = {
    id: employeeId,
    employeeId,
    merchantId,
    email: "nami@strawhatpirates.example.com",
    accountType: "owner",
  };
  const service = CreateSaleService.create({
    db,
    user,
    logger: pino({ enabled: false }),
    saleFinder: new SaleFinder(),
  });
  const request: CreateSaleRequest = {
    locationId,
    source: "pos.web",
    businessDate: new Date("2026-10-10T18:30:00.000Z"),
    lineItems: [{ variantId, price: "100.00", quantity: 2 }],
    payments: [{ method: "cash", amount: "200.00" }],
  };
  return {
    db,
    service,
    user,
    request,
    merchantId,
    employeeId,
    locationId,
    otherLocationId,
    productId,
    variantId,
    serviceProductId,
    serviceVariantId,
    customerId,
  };
}

async function inventoryState(db: Database) {
  return {
    levels: await db.select().from(tables.inventoryLevel).orderBy(tables.inventoryLevel.id),
    movements: await db.select().from(tables.inventoryMovement).orderBy(tables.inventoryMovement.id),
    products: await db.select().from(tables.product).orderBy(tables.product.id),
  };
}

async function checkoutState(db: Database) {
  return {
    ...(await inventoryState(db)),
    sales: await db.select().from(tables.sale).orderBy(tables.sale.id),
    items: await db.select().from(tables.saleItem).orderBy(tables.saleItem.id),
    payments: await db.select().from(tables.salePayment).orderBy(tables.salePayment.id),
    locations: await db.select().from(tables.location).orderBy(tables.location.id),
  };
}

async function enableStaff(
  context: Awaited<ReturnType<typeof setup>>,
  permissions = "checkout apply_discounts",
  cap = "0.10",
) {
  await context.db
    .update(tables.employee)
    .set({ isOwner: false, permissions, maxDiscountRate: cap })
    .where(eq(tables.employee.id, context.employeeId));
  await context.db.insert(tables.locationAccess).values({
    id: generateId({ model: "locationAccess" }),
    merchantId: context.merchantId,
    employeeId: context.employeeId,
    locationId: context.locationId,
  });
}

describe("CreateSaleService", () => {
  it("persists a fulfilled mixed checkout, snapshots prices, and deducts only physical stock at its location", async () => {
    const context = await setup();
    const { db, service, request, variantId, serviceVariantId, customerId, locationId, otherLocationId } = context;
    const before = await inventoryState(db);
    const startedAt = Date.now();

    const result = await service.execute({
      ...request,
      customerId,
      notes: "For the Sunny",
      lineItems: [...request.lineItems, { variantId: serviceVariantId, price: "20.00", quantity: 1 }],
      payments: [
        { method: "cash", amount: "100.00" },
        { method: "cash", amount: "120.00" },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.id).toMatch(/^sale_/);
    expect(result.value).toMatchObject({
      status: "fulfilled",
      transactionNumber: 42,
      customer: { id: customerId },
      notes: "For the Sunny",
      businessDate: request.businessDate,
    });
    const state = await checkoutState(db);
    expect(state.items).toHaveLength(2);
    expect(state.items.find((line) => line.variantId === variantId)).toMatchObject({
      quantity: 2,
      price: "100.00",
      unitCost: "50.00",
      shortageQuantity: 0,
    });
    expect(state.payments.map((payment) => payment.amount).sort()).toEqual(["100.00", "120.00"]);
    expect(state.levels.find((level) => level.locationId === locationId)?.onHand).toBe(3);
    expect(state.levels.find((level) => level.locationId === otherLocationId)).toEqual(
      before.levels.find((level) => level.locationId === otherLocationId),
    );
    expect(state.levels.some((level) => level.variantId === serviceVariantId)).toBe(false);
    expect(state.movements).toHaveLength(1);
    expect(state.movements[0]).toMatchObject({
      reason: "sale",
      fromState: "in_stock",
      toState: "sold",
      quantityDelta: -2,
      unitCost: "50.00",
      referenceId: result.value.id,
      createdById: context.employeeId,
    });
    expect(state.movements[0]!.occurredAt.getTime()).toBeGreaterThanOrEqual(startedAt - 1000);
    expect(state.movements[0]!.occurredAt).toEqual(result.value.createdAt);
    expect(state.products.find((product) => product.id === context.productId)).toMatchObject({
      unitCost: "50.00",
      inventoryVersion: 1,
    });
    expect(state.products.find((product) => product.id === context.serviceProductId)).toEqual(
      before.products.find((product) => product.id === context.serviceProductId),
    );
    expect(state.locations.find((location) => location.id === locationId)?.nextSaleNumber).toBe(43);
  });

  it.each(["pos.web", "pos.android", "pos.ios"] as const)(
    "records a pending %s sale without changing any inventory when one physical line is short",
    async (source) => {
      const { db, service, request, merchantId, productId, locationId, serviceVariantId } = await setup();
      const missingVariantId = generateId({ model: "variant" });
      await db
        .insert(tables.variant)
        .values({ id: missingVariantId, merchantId, productId, name: "Sanji's provisions", price: "100.00" });
      if (source === "pos.web")
        await db.update(tables.location).set({ allowBackorders: true }).where(eq(tables.location.id, locationId));
      const before = await inventoryState(db);

      const result = await service.execute({
        ...request,
        source,
        lineItems: [
          ...request.lineItems,
          { variantId: missingVariantId, quantity: 3, price: "100.00" },
          { variantId: serviceVariantId, quantity: 1, price: "20.00" },
        ],
        payments: [{ method: "cash", amount: "520.00" }],
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.value.status).toBe("pending");
      expect(result.value.lineItems.find((line) => line.variantId === missingVariantId)?.shortageQuantity).toBe(3);
      expect(
        result.value.lineItems
          .filter((line) => line.variantId !== missingVariantId)
          .map((line) => line.shortageQuantity),
      ).toEqual([0, 0]);
      expect(await inventoryState(db)).toEqual(before);
      expect(await db.select().from(tables.salePayment)).toHaveLength(1);
      expect(result.value.transactionNumber).toBe(42);
    },
  );

  it("records only the deficit and preserves nonzero stock for a pending line", async () => {
    const { db, service, request, locationId } = await setup();
    await db.update(tables.location).set({ allowBackorders: true }).where(eq(tables.location.id, locationId));
    const before = await inventoryState(db);
    const result = await service.execute({
      ...request,
      lineItems: [{ ...request.lineItems[0]!, quantity: 7 }],
      payments: [{ method: "cash", amount: "700.00" }],
    });
    expect(result.success && result.value.lineItems[0]?.shortageQuantity).toBe(2);
    expect(await inventoryState(db)).toEqual(before);
  });

  it("rejects web shortages without recording a sale or consuming its number", async () => {
    const { db, service, request } = await setup();
    const before = await checkoutState(db);
    const result = await service.execute({
      ...request,
      lineItems: [{ ...request.lineItems[0]!, quantity: 6 }],
      payments: [{ method: "cash", amount: "600.00" }],
    });
    expect(result).toMatchObject({ success: false, error: { code: codes.stockInsufficient } });
    expect(await checkoutState(db)).toEqual(before);
  });

  it("rounds discounted line totals and USD conversions before summing, retaining the location rate", async () => {
    const { db, service, request, serviceVariantId, serviceProductId, merchantId, locationId } = await setup();
    const secondVariantId = generateId({ model: "variant" });
    await db.insert(tables.variant).values({
      id: secondVariantId,
      merchantId,
      productId: serviceProductId,
      name: "Chopper's follow-up",
      price: "20.00",
    });
    await db.update(tables.location).set({ exchangeRate: "0.91" }).where(eq(tables.location.id, locationId));
    const result = await service.execute({
      ...request,
      discountRate: "0.10",
      lineItems: [
        { variantId: serviceVariantId, price: "10.05", quantity: 3 },
        { variantId: secondVariantId, price: "10.05", quantity: 3 },
      ],
      payments: [
        { method: "cash_dollar", amount: "9.95" },
        { method: "cash_dollar", amount: "9.95" },
        { method: "cash", amount: "36.18" },
      ],
    });
    expect(result.success).toBe(true);
    expect(await db.select().from(tables.salePayment)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "cash_dollar", amount: "9.95", exchangeRate: "0.91" }),
        expect.objectContaining({ method: "cash", exchangeRate: null }),
      ]),
    );
    expect(await db.select().from(tables.inventoryMovement)).toHaveLength(0);
  });

  it.each(["199.99", "200.01"])("rejects mismatched payments of %s without effects", async (amount) => {
    const { db, service, request } = await setup();
    const before = await checkoutState(db);
    const result = await service.execute({ ...request, payments: [{ method: "cash", amount }] });
    expect(result.success).toBe(false);
    expect(await checkoutState(db)).toEqual(before);
  });

  it("uses zero exchange rate as configured and rejects a dollar-only payment for a positive total", async () => {
    const { db, service, request, locationId } = await setup();
    await db.update(tables.location).set({ exchangeRate: "0.00" }).where(eq(tables.location.id, locationId));
    const before = await checkoutState(db);
    const result = await service.execute({ ...request, payments: [{ method: "cash_dollar", amount: "200.00" }] });
    expect(result).toMatchObject({ success: false, error: { code: codes.paymentInsufficient } });
    expect(await checkoutState(db)).toEqual(before);
  });

  it("allows owners a free zero-cost service with no payments", async () => {
    const { service, request, serviceVariantId } = await setup();
    const result = await service.execute({
      ...request,
      discountRate: "1.00",
      lineItems: [{ variantId: serviceVariantId, price: "20.00", quantity: 1 }],
      payments: [],
    });
    expect(result).toMatchObject({ success: true, value: { status: "fulfilled", payments: [] } });
  });

  it.each([
    { label: "below cost after a sale discount", price: "100.00", discountRate: "0.51", amount: "98.00" },
    { label: "below cost through a price change", price: "49.00", discountRate: "0.00", amount: "98.00" },
  ])("rejects owner pricing $label", async ({ price, discountRate, amount }) => {
    const { db, service, request } = await setup();
    const before = await checkoutState(db);
    const result = await service.execute({
      ...request,
      discountRate,
      lineItems: [{ ...request.lineItems[0]!, price }],
      payments: [{ method: "cash", amount }],
    });
    expect(result).toMatchObject({ success: false, error: { code: codes.priceBelowUnitCost } });
    expect(await checkoutState(db)).toEqual(before);
  });

  it("combines both discounts per line and does not let a marked-up service hide an exceeded staff cap", async () => {
    const context = await setup();
    await enableStaff(context, "checkout apply_discounts", "0.15");
    const before = await checkoutState(context.db);
    const result = await context.service.execute({
      ...context.request,
      discountRate: "0.10",
      lineItems: [
        { ...context.request.lineItems[0]!, price: "90.00" },
        { variantId: context.serviceVariantId, price: "200.00", quantity: 1 },
      ],
      payments: [{ method: "cash", amount: "342.00" }],
    });
    expect(result).toMatchObject({
      success: false,
      error: { code: codes.forbiddenError, details: [{ code: "discount_limit_exceeded" }] },
    });
    expect(await checkoutState(context.db)).toEqual(before);
  });

  it("accepts a staff discount exactly at the cap and unit-cost floor", async () => {
    const context = await setup();
    await enableStaff(context, "checkout apply_discounts", "0.50");
    const result = await context.service.execute({
      ...context.request,
      discountRate: "0.50",
      payments: [{ method: "cash", amount: "100.00" }],
    });
    expect(result.success).toBe(true);
  });

  it.each(["price", "sale"])("requires discount permission for a %s reduction even within the cap", async (kind) => {
    const context = await setup();
    await enableStaff(context, "checkout", "0.50");
    const before = await checkoutState(context.db);
    const result = await context.service.execute({
      ...context.request,
      discountRate: kind === "sale" ? "0.10" : "0.00",
      lineItems: [{ ...context.request.lineItems[0]!, price: kind === "price" ? "90.00" : "100.00" }],
      payments: [{ method: "cash", amount: "180.00" }],
    });
    expect(result).toMatchObject({ success: false, error: { code: codes.forbiddenError } });
    expect(await checkoutState(context.db)).toEqual(before);
  });

  it.each(["disabled", "permission", "location"])("rejects staff checkout with missing %s access", async (reason) => {
    const context = await setup();
    await enableStaff(context, reason === "permission" ? "apply_discounts" : "checkout");
    if (reason === "disabled")
      await context.db
        .update(tables.employee)
        .set({ status: "disabled" })
        .where(eq(tables.employee.id, context.employeeId));
    const before = await checkoutState(context.db);
    const result = await context.service.execute({
      ...context.request,
      locationId: reason === "location" ? context.otherLocationId : context.locationId,
    });
    expect(result).toMatchObject({ success: false, error: { code: codes.forbiddenError } });
    expect(await checkoutState(context.db)).toEqual(before);
  });

  it.each(["draft", "archived"] as const)("rejects %s products", async (status) => {
    const { db, service, request, productId } = await setup();
    await db.update(tables.product).set({ status }).where(eq(tables.product.id, productId));
    const before = await checkoutState(db);
    expect(await service.execute(request)).toMatchObject({ success: false, error: { code: codes.validationError } });
    expect(await checkoutState(db)).toEqual(before);
  });

  it("rejects duplicate variants without effects", async () => {
    const { db, service, request } = await setup();
    const before = await checkoutState(db);
    expect(
      await service.execute({
        ...request,
        lineItems: [...request.lineItems, ...request.lineItems],
        payments: [{ method: "cash", amount: "400.00" }],
      }),
    ).toMatchObject({ success: false, error: { code: codes.validationError } });
    expect(await checkoutState(db)).toEqual(before);
  });

  it.each(["variant", "customer", "location"])("rejects a foreign merchant's %s", async (resource) => {
    const { db, service, request, variantId, customerId, locationId } = await setup();
    const merchantId = generateId({ model: "merchant" });
    await db.insert(tables.merchant).values({ id: merchantId, name: "Heart Pirates" });
    const foreignLocationId = generateId({ model: "location" });
    const foreignCustomerId = generateId({ model: "customer" });
    const foreignProductId = generateId({ model: "product" });
    const foreignVariantId = generateId({ model: "variant" });
    await db.insert(tables.location).values({ id: foreignLocationId, merchantId, name: "Zou" });
    await db.insert(tables.customer).values({ id: foreignCustomerId, merchantId, name: "Bepo" });
    await db.insert(tables.product).values({
      id: foreignProductId,
      merchantId,
      name: "Polar Tang provisions",
      slug: "provisions",
      price: "100",
      unitCost: "50",
      status: "active",
    });
    await db
      .insert(tables.variant)
      .values({ id: foreignVariantId, merchantId, productId: foreignProductId, name: "Crate", price: "100" });
    const before = await checkoutState(db);
    const result = await service.execute({
      ...request,
      customerId: resource === "customer" ? foreignCustomerId : customerId,
      locationId: resource === "location" ? foreignLocationId : locationId,
      lineItems: [{ ...request.lineItems[0]!, variantId: resource === "variant" ? foreignVariantId : variantId }],
    });
    expect(result).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    expect(await checkoutState(db)).toEqual(before);
  });

  it("propagates a sale insert uniqueness failure without changing its effects", async () => {
    const { db, service, request, merchantId, employeeId, locationId } = await setup();
    await db.insert(tables.sale).values({
      id: generateId({ model: "sale" }),
      merchantId,
      locationId,
      source: request.source,
      businessDate: request.businessDate,
      status: "fulfilled",
      transactionNumber: 42,
      createdById: employeeId,
    });
    const before = await checkoutState(db);
    const transactionSpy = vi.spyOn(db, "transaction");

    try {
      await expect(service.execute(request)).rejects.toMatchObject({ cause: { code: "ER_DUP_ENTRY" } });
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(await checkoutState(db)).toEqual(before);
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it("allows only one competing web checkout for the last unit", async () => {
    const { db, service, request } = await setup();
    await db
      .update(tables.inventoryLevel)
      .set({ onHand: 1 })
      .where(eq(tables.inventoryLevel.locationId, request.locationId));
    const checkout = {
      ...request,
      lineItems: [{ ...request.lineItems[0]!, quantity: 1 }],
      payments: [{ method: "cash" as const, amount: "100.00" }],
    };
    const results = await Promise.all(Array.from({ length: 6 }, () => service.execute(checkout)));
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(
      results
        .filter((result) => !result.success)
        .every((result) => !result.success && result.error.code === codes.stockInsufficient),
    ).toBe(true);
    const state = await checkoutState(db);
    expect(state.sales).toHaveLength(1);
    expect(state.movements).toHaveLength(1);
    expect(state.levels.find((level) => level.locationId === request.locationId)?.onHand).toBe(0);
    expect(state.locations.find((location) => location.id === request.locationId)?.nextSaleNumber).toBe(43);
  });

  it("allocates distinct consecutive numbers for overlapping checkouts of different products", async () => {
    const { db, service, request, merchantId, serviceVariantId } = await setup();
    const secondProductId = generateId({ model: "product" });
    const secondVariantId = generateId({ model: "variant" });
    await db.insert(tables.product).values({
      id: secondProductId,
      merchantId,
      name: "Franky's repairs",
      slug: "frankys-repairs",
      price: "20",
      unitCost: "0",
      type: "service",
      status: "active",
    });
    await db
      .insert(tables.variant)
      .values({ id: secondVariantId, merchantId, productId: secondProductId, name: "Repair", price: "20" });

    const results = await waitForBlockedUpdate(db, "locations", generateId(), () =>
      Promise.all(
        [serviceVariantId, secondVariantId].map((variantId) =>
          service.execute({
            ...request,
            lineItems: [{ variantId, price: "20", quantity: 1 }],
            payments: [{ method: "cash", amount: "20" }],
          }),
        ),
      ),
    );

    expect(results.every((result) => result.success)).toBe(true);
    const sales = await db.select().from(tables.sale).where(eq(tables.sale.locationId, request.locationId));
    expect(sales.map((sale) => sale.transactionNumber).sort()).toEqual([42, 43]);
    const [location] = await db.select().from(tables.location).where(eq(tables.location.id, request.locationId));
    expect(location?.nextSaleNumber).toBe(44);
    expect(await db.select().from(tables.inventoryMovement)).toHaveLength(0);
  });

  it("rolls back all effects when movement persistence fails after the stock deduction", async () => {
    const { db, service, request } = await setup();
    const before = await checkoutState(db);
    await db.execute(
      sql`CREATE TRIGGER reject_sale_movement BEFORE INSERT ON inventory_movements FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Movement storage unavailable'`,
    );
    const transactionSpy = vi.spyOn(db, "transaction");
    try {
      await expect(service.execute(request)).rejects.toMatchObject({
        cause: { sqlState: "45000", sqlMessage: "Movement storage unavailable" },
      });
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(await checkoutState(db)).toEqual(before);
    } finally {
      try {
        await db.execute(sql`DROP TRIGGER reject_sale_movement`);
      } finally {
        transactionSpy.mockRestore();
      }
    }
    expect(await service.execute(request)).toMatchObject({ success: true, value: { transactionNumber: 42 } });
  });

  it("coordinates sales with purchases without losing stock or using a stale pooled cost", async () => {
    const context = await setup();
    const { db, service, request, merchantId, productId, variantId, locationId, user } = context;
    const supplierId = generateId({ model: "supplier" });
    await db.insert(tables.supplier).values({ id: supplierId, merchantId, name: "Baratie" });
    const purchaseService = CreatePurchaseService.create({
      db,
      user,
      logger: pino({ enabled: false }),
      purchaseFinder: new PurchaseFinder(),
    });
    const [sale, purchase] = await Promise.all([
      service.execute(request),
      purchaseService.execute({ supplierId, locationId, lineItems: [{ variantId, quantity: 2, unitCost: "80.00" }] }),
    ]);
    expect(sale.success).toBe(true);
    expect(purchase.success).toBe(true);
    if (!sale.success) return;
    const [product] = await db.select().from(tables.product).where(eq(tables.product.id, productId));
    // Initial pooled stock is 12. A sale-first purchase averages over 10 remaining units.
    expect(product?.unitCost).toBe(sale.value.lineItems[0]!.unitCost === "50.00" ? "55.00" : "54.29");
    expect(product?.inventoryVersion).toBe(2);
    const [level] = await db
      .select()
      .from(tables.inventoryLevel)
      .where(and(eq(tables.inventoryLevel.locationId, locationId), eq(tables.inventoryLevel.variantId, variantId)));
    expect(level?.onHand).toBe(5);
    expect(await db.select().from(tables.inventoryMovement)).toHaveLength(2);
  });
});
