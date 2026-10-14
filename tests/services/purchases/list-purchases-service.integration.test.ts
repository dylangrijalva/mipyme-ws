import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { PurchasePaginationRequest } from "../../../src/contracts/purchase-pagination-query.ts";
import { tables } from "../../../src/db/schema.ts";
import { ListPurchasesService } from "../../../src/services/purchases/list-purchases-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import { seedPurchaseReads } from "../../test-utils/purchase-read-fixture.ts";

async function setup() {
  return seedPurchaseReads(await prepareDatabase());
}

describe("ListPurchasesService", () => {
  it("paginates timestamp ties and microseconds without losing records or leaking foreign purchases and items", async () => {
    const context = await setup();
    const service = ListPurchasesService.create(context.dependencies);
    const before = await context.dependencies.db.select().from(tables.purchaseOrder);
    const itemsBefore = await context.dependencies.db.select().from(tables.purchaseOrderItem);
    const ids: Array<string> = [];
    let cursor: string | undefined;

    for (const expectedId of [context.ids[3], context.ids[1], context.ids[0], context.ids[2]]) {
      const result = await service.execute(PurchasePaginationRequest.parse({ limit: 1, cursor }));

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.value.results.map((purchase) => purchase.id)).toEqual([expectedId]);
      ids.push(result.value.results[0].id);
      expect(result.value.hasMore).toBe(expectedId !== context.ids[2]);
      expect(result.value.nextCursor).toEqual(expectedId === context.ids[2] ? null : expect.any(String));
      cursor = result.value.nextCursor ?? undefined;
    }
    expect(ids).toEqual([context.ids[3], context.ids[1], context.ids[0], context.ids[2]]);
    const all = await service.execute({ limit: 50 });
    expect(all.success).toBe(true);
    if (!all.success) return;
    expect(
      all.value.results.map((purchase) => ({ id: purchase.id, items: purchase.lineItems.map((item) => item.id) })),
    ).toEqual([
      { id: context.ids[3], items: [] },
      { id: context.ids[1], items: [context.itemId] },
      { id: context.ids[0], items: [] },
      { id: context.ids[2], items: [] },
    ]);
    expect(all.value.results[1]).toMatchObject({
      supplier: { id: context.supplierId },
      createdBy: { id: context.employeeId },
      lineItems: [{ unitCost: "10.00", price: "20.00", variants: [{ id: context.variantId, quantity: 2 }] }],
    });
    expect(await context.dependencies.db.select().from(tables.purchaseOrder)).toEqual(before);
    expect(await context.dependencies.db.select().from(tables.purchaseOrderItem)).toEqual(itemsBefore);
  });

  it("applies each filter and combines inclusive date bounds with UTC offsets and submillisecond precision", async () => {
    const context = await setup();
    const service = ListPurchasesService.create(context.dependencies);
    const cases = [
      { query: { locationId: context.inaccessibleLocationId }, ids: [context.ids[3]] },
      { query: { status: "voided" }, ids: [context.ids[1]] },
      { query: { supplierId: context.otherSupplierId }, ids: [context.ids[2]] },
      { query: { from: "2026-10-10T18:30:00.123456Z" }, ids: [context.ids[3], context.ids[1], context.ids[0]] },
      { query: { to: "2026-10-10T12:30:00.123455-06:00" }, ids: [context.ids[2]] },
      { query: { from: "2026-10-10T18:30:00.1234561Z", to: "2026-10-10T18:30:00.1234569Z" }, ids: [] },
      { query: { from: "2026-10-10T18:30:00.9999999Z" }, ids: [context.ids[3]] },
      {
        query: {
          locationId: context.locationId,
          supplierId: context.supplierId,
          status: "voided",
          from: "2026-10-10T12:30:00.123456-06:00",
          to: "2026-10-10T18:30:00.123456Z",
        },
        ids: [context.ids[1]],
      },
      { query: { locationId: context.foreignLocationId }, ids: [] },
      { query: { supplierId: context.foreignSupplierId }, ids: [] },
    ];

    for (const scenario of cases) {
      const result = await service.execute(PurchasePaginationRequest.parse(scenario.query));

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.value.results.map((purchase) => purchase.id)).toEqual(scenario.ids);
      expect(result.value).toMatchObject({ nextCursor: null, hasMore: false });
    }
    const first = await service.execute(PurchasePaginationRequest.parse({ limit: 1, supplierId: context.supplierId }));
    expect(first.success).toBe(true);
    if (!first.success) return;
    const next = await service.execute(
      PurchasePaginationRequest.parse({ limit: 1, supplierId: context.supplierId, cursor: first.value.nextCursor }),
    );
    expect(next).toMatchObject({ success: true, value: { results: [{ id: context.ids[1] }], hasMore: true } });
  });

  it("limits staff to assigned locations even with filters and returns an empty page without access", async () => {
    const context = await setup();
    const { db } = context.dependencies;
    await db
      .update(tables.employee)
      .set({ isOwner: false, permissions: "view_transactions" })
      .where(eq(tables.employee.id, context.employeeId));
    const service = ListPurchasesService.create({
      ...context.dependencies,
      user: { ...context.dependencies.user, accountType: "staff" },
    });

    expect(await service.execute({ limit: 50 })).toEqual({
      success: true,
      value: { results: [], nextCursor: null, hasMore: false },
    });
    await db.insert(tables.locationAccess).values({
      id: generateId({ model: "locationAccess" }),
      merchantId: context.merchantId,
      employeeId: context.employeeId,
      locationId: context.locationId,
    });
    const allowed = await service.execute({ limit: 50 });
    const hidden = await service.execute({ limit: 50, locationId: context.inaccessibleLocationId });

    expect(allowed.success).toBe(true);
    if (!allowed.success) return;
    expect(allowed.value.results.map((purchase) => purchase.id)).toEqual([
      context.ids[1],
      context.ids[0],
      context.ids[2],
    ]);
    expect(hidden).toEqual({ success: true, value: { results: [], nextCursor: null, hasMore: false } });
  });

  it.each([
    { status: "enabled" as const, permissions: "checkout", isOwner: false },
    { status: "disabled" as const, permissions: "view_transactions", isOwner: false },
    { status: "disabled" as const, permissions: "", isOwner: true },
  ])("rejects a $status reader with owner=$isOwner and permissions=$permissions", async (employee) => {
    const context = await setup();
    await context.dependencies.db
      .update(tables.employee)
      .set(employee)
      .where(eq(tables.employee.id, context.employeeId));

    const result = await ListPurchasesService.create(context.dependencies).execute({ limit: 50 });

    expect(result).toMatchObject({ success: false, error: { code: "forbidden_error" } });
  });

  it("rejects missing and foreign employee identities", async () => {
    const context = await setup();
    for (const employeeId of [generateId({ model: "employee" }), context.employeeId]) {
      const user = { ...context.dependencies.user, employeeId, merchantId: context.otherMerchantId };

      const result = await ListPurchasesService.create({ ...context.dependencies, user }).execute({ limit: 50 });

      expect(result).toMatchObject({ success: false, error: { code: "forbidden_error" } });
    }
  });
});
