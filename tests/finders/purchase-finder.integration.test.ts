import { describe, expect, it } from "vitest";
import { tables } from "../../src/db/schema.ts";
import { PurchaseFinder } from "../../src/finders/purchase-finder.ts";
import { generateId } from "../../src/utils/generate-id.ts";
import { prepareDatabase } from "../prepare-db.ts";

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  const supplierId = generateId({ model: "supplier" });
  const employeeId = generateId({ model: "employee" });
  const locationId = generateId({ model: "location" });
  const productId = generateId({ model: "product" });
  const variantId = generateId({ model: "variant" });
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  await db.insert(tables.supplier).values({ id: supplierId, merchantId, name: "Baratie" });
  await db.insert(tables.employee).values({ id: employeeId, merchantId, name: "Sanji", pin: "4821" });
  await db.insert(tables.location).values({ id: locationId, merchantId, name: "Thousand Sunny" });
  await db.insert(tables.product).values({
    id: productId,
    merchantId,
    name: "Provisions",
    slug: "provisions",
    price: "25.00",
    unitCost: "8.00",
    type: "item",
    status: "active",
  });
  await db.insert(tables.variant).values({
    id: variantId,
    merchantId,
    productId,
    name: "Current provision name",
    price: "25.00",
  });
  return { db, merchantId, otherMerchantId, supplierId, employeeId, locationId, productId, variantId };
}

describe("PurchaseFinder", () => {
  it("hydrates an uncommitted purchase with ordered item snapshots and excludes another purchase's items", async () => {
    const { db, merchantId, supplierId, employeeId, locationId, productId, variantId } = await setup();
    const secondVariantId = generateId({ model: "variant" });
    await db.insert(tables.variant).values({
      id: secondVariantId,
      merchantId,
      productId,
      name: "Current seafood name",
      price: "40.00",
    });
    const id = generateId({ model: "purchaseOrder" });
    const otherPurchaseId = generateId({ model: "purchaseOrder" });
    const firstItemId = "purc_ite_000000000000001";
    const lastItemId = "purc_ite_000000000000003";
    const timestamp = new Date("2026-01-01T00:00:00Z");
    const finder = new PurchaseFinder();

    const found = await db.transaction(async (transaction) => {
      await transaction.insert(tables.purchaseOrder).values([
        {
          id,
          merchantId,
          supplierId,
          createdById: employeeId,
          locationId,
          transactionNumber: 42,
          status: "fulfilled",
          notes: "Provisions for Wano",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: otherPurchaseId,
          merchantId,
          supplierId,
          createdById: employeeId,
          locationId,
          transactionNumber: 43,
          status: "fulfilled",
        },
      ]);
      await transaction.insert(tables.purchaseOrderItem).values([
        {
          id: lastItemId,
          merchantId,
          purchaseOrderId: id,
          variantId: secondVariantId,
          name: "Sanji's seafood",
          quantity: 3,
          price: "30.00",
          unitCost: "12.50",
        },
        {
          id: "purc_ite_000000000000002",
          merchantId,
          purchaseOrderId: otherPurchaseId,
          variantId,
          name: "Unrelated provisions",
          quantity: 99,
          price: "50.00",
          unitCost: "20.00",
        },
        {
          id: firstItemId,
          merchantId,
          purchaseOrderId: id,
          variantId,
          name: "Nami's mandarins",
          quantity: 2,
          price: "25.00",
          unitCost: "8.00",
        },
      ]);
      return finder.find(transaction, { merchantId, id });
    });

    expect(found).toEqual({
      voidReason: null,
      voidedBy: null,
      voidedAt: null,
      id,
      transactionNumber: 42,
      status: "fulfilled",
      locationId,
      supplier: { id: supplierId, name: "Baratie" },
      createdBy: { id: employeeId, name: "Sanji" },
      notes: "Provisions for Wano",
      createdAt: timestamp,
      updatedAt: timestamp,
      lineItems: [
        {
          id: firstItemId,
          price: "25.00",
          unitCost: "8.00",
          variants: [{ id: variantId, name: "Nami's mandarins", quantity: 2 }],
        },
        {
          id: lastItemId,
          price: "30.00",
          unitCost: "12.50",
          variants: [{ id: secondVariantId, name: "Sanji's seafood", quantity: 3 }],
        },
      ],
    });
  });

  it("returns a voided purchase without items and null for missing or foreign purchases", async () => {
    const { db, merchantId, otherMerchantId, supplierId, employeeId, locationId } = await setup();
    const id = generateId({ model: "purchaseOrder" });
    await db.insert(tables.purchaseOrder).values({
      id,
      merchantId,
      supplierId,
      createdById: employeeId,
      locationId,
      transactionNumber: 42,
      status: "voided",
    });
    const finder = new PurchaseFinder();

    const found = await finder.find(db, { merchantId, id });
    const foreign = await finder.find(db, { merchantId: otherMerchantId, id });
    const missing = await finder.find(db, { merchantId, id: "missing" });

    expect(found).toMatchObject({
      id,
      status: "voided",
      notes: null,
      lineItems: [],
      createdBy: { id: employeeId, name: "Sanji" },
    });
    expect(foreign).toBeNull();
    expect(missing).toBeNull();
  });
});
