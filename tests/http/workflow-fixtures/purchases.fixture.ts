import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { createDrizzle, type Database } from "../../../src/db/index.ts";
import { tables } from "../../../src/db/schema.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { seedPurchaseReads } from "../../test-utils/purchase-read-fixture.ts";

type FixturePluginStep = {
  params?: {
    action?: "setup" | "cleanup";
  };
};
type WorkflowCaptures = Record<string, unknown>;
type WorkflowOptions = {
  env?: Record<string, string>;
};
type PurchaseReadFixture = Awaited<ReturnType<typeof preparePurchaseReadWorkflow>>;

const fixtureId = "purchase-reads";
const activeFixtures = new Map<string, { database: ReturnType<typeof createDrizzle>; fixture: PurchaseReadFixture }>();

export default async function runPurchaseReadFixture(
  step: FixturePluginStep,
  captures: WorkflowCaptures,
  _cookies: unknown,
  _schemaValidator: unknown,
  options?: WorkflowOptions,
): Promise<Record<string, unknown>> {
  const action = step.params?.action;
  if (action === "setup") {
    const testUserId = options?.env?.testUserId;
    if (!testUserId) {
      throw new Error("The test user ID is required to prepare purchase workflow data.");
    }

    const database = createDrizzle(process.env["DB_URL"]!);
    return database
      .transaction((transaction) => preparePurchaseReadWorkflow(transaction as Database, testUserId, database))
      .then(
        (fixture) => {
          activeFixtures.set(fixtureId, { database, fixture });
          Object.assign(captures, fixture.environment);
          captures["purchaseReadFixtureId"] = fixtureId;
          return {};
        },
        async (error: unknown) => {
          await database.$client.promise().end();
          throw error;
        },
      );
  }

  if (action !== "cleanup") {
    throw new Error("Unsupported purchase fixture action: " + action);
  }

  const activeFixtureId = captures["purchaseReadFixtureId"];
  if (typeof activeFixtureId !== "string") {
    return {};
  }

  const activeFixture = activeFixtures.get(activeFixtureId);
  if (!activeFixture) {
    return {};
  }
  activeFixtures.delete(activeFixtureId);

  await activeFixture.fixture
    .verify()
    .finally(() => activeFixture.fixture.cleanup().finally(() => activeFixture.database.$client.promise().end()));
  return {};
}

async function preparePurchaseReadWorkflow(setupDb: Database, testUserId: string, db: Database = setupDb) {
  const [account] = await setupDb.select().from(tables.account).where(eq(tables.account.externalId, testUserId));
  const [employee] = account
    ? await setupDb.select().from(tables.employee).where(eq(tables.employee.accountId, account.id))
    : [];
  const context = await seedPurchaseReads(
    setupDb,
    employee ? { merchantId: employee.merchantId, employeeId: employee.id } : undefined,
  );
  const accountId = account?.id ?? generateId({ model: "account" });
  if (!account) {
    await setupDb.insert(tables.account).values({
      id: accountId,
      merchantId: context.merchantId,
      externalId: testUserId,
      email: "nami@strawhatpirates.example.com",
    });
    await setupDb.update(tables.employee).set({ accountId }).where(eq(tables.employee.id, context.employeeId));
  }
  await setupDb
    .update(tables.location)
    .set({ nextPurchaseOrderNumber: 10 })
    .where(eq(tables.location.id, context.locationId));
  const purchasesBefore = await setupDb
    .select()
    .from(tables.purchaseOrder)
    .where(inArray(tables.purchaseOrder.id, context.ids))
    .orderBy(tables.purchaseOrder.id);
  const itemsBefore = await setupDb
    .select()
    .from(tables.purchaseOrderItem)
    .where(eq(tables.purchaseOrderItem.id, context.itemId));
  return {
    environment: {
      purchaseEmployeeId: context.employeeId,
      purchaseId: context.ids[1],
      newestPurchaseId: context.ids[3],
      secondPurchaseId: context.ids[0],
      oldestPurchaseId: context.ids[2],
      foreignPurchaseId: context.ids[4],
      purchaseLocationId: context.locationId,
      purchaseSupplierId: context.supplierId,
      purchaseVariantId: context.variantId,
    },
    async verify() {
      assert.deepEqual(
        await db
          .select()
          .from(tables.purchaseOrder)
          .where(inArray(tables.purchaseOrder.id, context.ids))
          .orderBy(tables.purchaseOrder.id),
        purchasesBefore,
      );
      assert.deepEqual(
        await db.select().from(tables.purchaseOrderItem).where(eq(tables.purchaseOrderItem.id, context.itemId)),
        itemsBefore,
      );
      const orders = (
        await db.select().from(tables.purchaseOrder).where(eq(tables.purchaseOrder.supplierId, context.supplierId))
      )
        .filter((order) => !context.ids.includes(order.id))
        .sort((left, right) => left.transactionNumber - right.transactionNumber);
      assert.equal(orders.length, 3);
      assert.deepEqual(
        orders.map((order) => order.status),
        ["voided", "fulfilled", "voided"],
      );
      assert.equal(orders[0].voidReason, "Wrong supplier delivery");
      assert.equal(orders[0].voidedById, context.employeeId);
      assert(orders[0].voidedAt instanceof Date);
      assert.equal(orders[1].voidedAt, null);
      assert.equal(orders[2].voidReason, null);
      const [product] = await db.select().from(tables.product).where(eq(tables.product.id, context.productId));
      assert.equal(product.unitCost, "12.00");
      assert.equal(product.lastSoldAt, null);
      const levels = await db
        .select()
        .from(tables.inventoryLevel)
        .where(eq(tables.inventoryLevel.variantId, context.variantId));
      assert.equal(levels.length, 1);
      assert.equal(levels[0].onHand, 2);
      const movements = await db
        .select()
        .from(tables.inventoryMovement)
        .where(eq(tables.inventoryMovement.inventoryLevelId, levels[0].id));
      assert.equal(movements.length, 5);
      assert.deepEqual(
        movements
          .filter((movement) => movement.reason === "purchase_void")
          .map((movement) => movement.quantityDelta)
          .sort(),
        [-2, -1].sort(),
      );
      assert.equal(
        movements.filter((movement) => movement.referenceId === orders[1].id && movement.reason === "purchase_void")
          .length,
        0,
      );
    },
    async cleanup() {
      const orders = await db
        .select()
        .from(tables.purchaseOrder)
        .where(
          inArray(tables.purchaseOrder.locationId, [
            context.locationId,
            context.inaccessibleLocationId,
            context.foreignLocationId,
          ]),
        );
      const orderIds = orders.map((order) => order.id);
      const levels = await db
        .select()
        .from(tables.inventoryLevel)
        .where(eq(tables.inventoryLevel.variantId, context.variantId));
      await db.transaction(async (transaction) => {
        if (levels.length) {
          await transaction.delete(tables.inventoryMovement).where(
            inArray(
              tables.inventoryMovement.inventoryLevelId,
              levels.map((level) => level.id),
            ),
          );
        }
        await transaction
          .delete(tables.purchaseOrderItem)
          .where(inArray(tables.purchaseOrderItem.purchaseOrderId, orderIds));
        await transaction.delete(tables.purchaseOrder).where(inArray(tables.purchaseOrder.id, orderIds));
        await transaction.delete(tables.supplierProduct).where(eq(tables.supplierProduct.productId, context.productId));
        await transaction.delete(tables.inventoryLevel).where(eq(tables.inventoryLevel.variantId, context.variantId));
        await transaction.delete(tables.variant).where(eq(tables.variant.id, context.variantId));
        await transaction.delete(tables.product).where(eq(tables.product.id, context.productId));
        await transaction
          .delete(tables.supplier)
          .where(inArray(tables.supplier.id, [context.supplierId, context.otherSupplierId, context.foreignSupplierId]));
        await transaction
          .delete(tables.location)
          .where(
            inArray(tables.location.id, [
              context.locationId,
              context.inaccessibleLocationId,
              context.foreignLocationId,
            ]),
          );
        await transaction.delete(tables.employee).where(eq(tables.employee.merchantId, context.otherMerchantId));
        await transaction.delete(tables.merchant).where(eq(tables.merchant.id, context.otherMerchantId));
        if (!account) {
          await transaction.delete(tables.employee).where(eq(tables.employee.id, context.employeeId));
          await transaction.delete(tables.account).where(eq(tables.account.id, accountId));
          await transaction.delete(tables.merchant).where(eq(tables.merchant.id, context.merchantId));
        }
      });
    },
  };
}
