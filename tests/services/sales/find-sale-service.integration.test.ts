import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import { tables } from "../../../src/db/schema.ts";
import { FindSaleService } from "../../../src/services/sales/find-sale-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareSaleReads } from "./read-sale-fixture.ts";

describe("FindSaleService", () => {
  it("returns a full voided sale with its original payment and related people without changing it", async () => {
    const context = await prepareSaleReads();
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
    const context = await prepareSaleReads();
    const service = FindSaleService.create(context.dependencies);

    for (const id of [generateId({ model: "sale" }), context.ids[4]]) {
      const result = await service.execute(id);

      expect(result).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    }
  });

  it("lets permitted staff read assigned locations and hides other locations", async () => {
    const context = await prepareSaleReads();
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
    const context = await prepareSaleReads();
    await context.db.update(tables.employee).set(employee).where(eq(tables.employee.id, context.employeeId));
    const service = FindSaleService.create(context.dependencies);

    const result = await service.execute(context.ids[0]);

    expect(result).toMatchObject({ success: false, error: { code: codes.forbiddenError } });
  });
});
