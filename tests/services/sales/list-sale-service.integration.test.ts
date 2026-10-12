import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { SalePaginationRequest } from "../../../src/contracts/sale-pagination-query.ts";
import { tables } from "../../../src/db/schema.ts";
import { ListSalesService } from "../../../src/services/sales/list-sale-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareSaleReads } from "./read-sale-fixture.ts";

describe("ListSalesService", () => {
  it("paginates newest first through timestamp ties and microseconds, excludes foreign sales, and returns full records", async () => {
    const context = await prepareSaleReads();
    const service = ListSalesService.create(context.dependencies);
    const pages = [];
    const ids: Array<string> = [];
    const first = await service.execute(SalePaginationRequest.parse({ limit: 1 }));
    expect(first.success).toBe(true);
    if (!first.success) return;
    pages.push(first.value);
    ids.push(...first.value.results.map((sale) => sale.id));

    for (const expectedId of [context.ids[1], context.ids[0], context.ids[2]]) {
      const previous = pages[pages.length - 1];
      expect(previous.hasMore).toBe(true);
      expect(previous.nextCursor).toEqual(expect.any(String));
      const next = await service.execute(SalePaginationRequest.parse({ limit: 1, cursor: previous.nextCursor }));
      expect(next.success).toBe(true);
      if (!next.success) return;
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
    if (!combined.success) return;
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
    const context = await prepareSaleReads();
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
      if (!result.success) return;
      expect(result.value.results.map((sale) => sale.id)).toEqual(scenario.ids);
      expect(result.value).toMatchObject({ nextCursor: null, hasMore: false });
    }
  });

  it("limits permitted staff to assigned locations, including filtered requests, and rejects missing permission", async () => {
    const context = await prepareSaleReads();
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
    if (!allowed.success) return;
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
