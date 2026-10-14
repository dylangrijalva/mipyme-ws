import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import { tables } from "../../../src/db/schema.ts";
import { FindPurchaseService } from "../../../src/services/purchases/find-purchase-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import { seedPurchaseReads } from "../../test-utils/purchase-read-fixture.ts";

async function setup() {
  return seedPurchaseReads(await prepareDatabase());
}

describe("FindPurchaseService", () => {
  it("returns a full voided purchase without changing purchase records or items", async () => {
    const context = await setup();
    const { db } = context.dependencies;
    const before = await db.select().from(tables.purchaseOrder);
    const itemsBefore = await db.select().from(tables.purchaseOrderItem);
    const service = FindPurchaseService.create(context.dependencies);

    const result = await service.execute(context.ids[1]);

    expect(result).toMatchObject({
      success: true,
      value: {
        id: context.ids[1],
        status: "voided",
        transactionNumber: 2,
        locationId: context.locationId,
        supplier: { id: context.supplierId, name: "Baratie" },
        createdBy: { id: context.employeeId, name: "Nami" },
        notes: "Provisions for the Sunny",
        createdAt: new Date("2026-10-10T18:30:00.123Z"),
        lineItems: [
          {
            id: context.itemId,
            unitCost: "10.00",
            price: "20.00",
            variants: [{ id: context.variantId, name: "Nami's crate", quantity: 2 }],
          },
        ],
      },
    });
    expect(await db.select().from(tables.purchaseOrder)).toEqual(before);
    expect(await db.select().from(tables.purchaseOrderItem)).toEqual(itemsBefore);
  });

  it("hides missing and foreign purchases", async () => {
    const context = await setup();
    const service = FindPurchaseService.create(context.dependencies);

    for (const id of [generateId({ model: "purchaseOrder" }), context.ids[4]]) {
      expect(await service.execute(id)).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    }
  });

  it("lets permitted staff read assigned locations and hides other locations", async () => {
    const context = await setup();
    const { db } = context.dependencies;
    await db
      .update(tables.employee)
      .set({ isOwner: false, permissions: "view_transactions" })
      .where(eq(tables.employee.id, context.employeeId));
    await db.insert(tables.locationAccess).values({
      id: generateId({ model: "locationAccess" }),
      merchantId: context.merchantId,
      employeeId: context.employeeId,
      locationId: context.locationId,
    });
    const service = FindPurchaseService.create({
      ...context.dependencies,
      user: { ...context.dependencies.user, accountType: "staff" },
    });

    const allowed = await service.execute(context.ids[0]);
    const hidden = await service.execute(context.ids[3]);

    expect(allowed).toMatchObject({ success: true, value: { id: context.ids[0], lineItems: [] } });
    expect(hidden).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
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

    const result = await FindPurchaseService.create(context.dependencies).execute(context.ids[0]);

    expect(result).toMatchObject({ success: false, error: { code: codes.forbiddenError } });
  });

  it("rejects missing and foreign employee identities", async () => {
    const context = await setup();
    for (const employeeId of [generateId({ model: "employee" }), context.employeeId]) {
      const user = { ...context.dependencies.user, employeeId, merchantId: context.otherMerchantId };

      const result = await FindPurchaseService.create({ ...context.dependencies, user }).execute(context.ids[4]);

      expect(result).toMatchObject({ success: false, error: { code: codes.forbiddenError } });
    }
  });
});
