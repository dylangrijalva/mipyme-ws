import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { createDrizzle, type Database } from "../../../src/db/index.ts";
import { tables } from "../../../src/db/schema.ts";
import { generateId } from "../../../src/utils/generate-id.ts";

type FixturePluginStep = {
  params?: {
    action?: "setup" | "cleanup";
  };
};
type WorkflowCaptures = Record<string, unknown>;
type WorkflowOptions = {
  env?: Record<string, string>;
};
type PendingSaleFixture = Awaited<ReturnType<typeof preparePendingSaleWorkflow>>;

const fixtureId = "pending-sales";
const activeFixtures = new Map<string, { database: ReturnType<typeof createDrizzle>; fixture: PendingSaleFixture }>();

export default async function runPendingSaleFixture(
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
      throw new Error("The test user ID is required to prepare sales workflow data.");
    }

    const database = createDrizzle(process.env["DB_URL"]!);
    return database
      .transaction((transaction) => preparePendingSaleWorkflow(transaction as Database, testUserId, database))
      .then(
        (fixture) => {
          activeFixtures.set(fixtureId, { database, fixture });
          Object.assign(captures, fixture.environment);
          captures["pendingSaleFixtureId"] = fixtureId;
          return {};
        },
        async (error: unknown) => {
          await database.$client.promise().end();
          throw error;
        },
      );
  }

  if (action !== "cleanup") {
    throw new Error("Unsupported sales fixture action: " + action);
  }

  const activeFixtureId = captures["pendingSaleFixtureId"];
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

async function preparePendingSaleWorkflow(setupDb: Database, testUserId: string, db: Database = setupDb) {
  const [account] = await setupDb.select().from(tables.account).where(eq(tables.account.externalId, testUserId));
  const merchantId = account?.merchantId ?? generateId({ model: "merchant" });
  const accountId = account?.id ?? generateId({ model: "account" });
  if (!account) {
    await setupDb.insert(tables.merchant).values({ id: merchantId, name: "Straw Hat Pirates" });
    await setupDb.insert(tables.account).values({
      id: accountId,
      merchantId,
      externalId: testUserId,
      email: "nami@strawhatpirates.example.com",
    });
    await setupDb.insert(tables.employee).values({
      id: generateId({ model: "employee" }),
      merchantId,
      accountId,
      name: "Nami",
      isOwner: true,
      status: "enabled",
      pin: "4821",
    });
  }

  const webLocationId = generateId({ model: "location" });
  const mobileLocationId = generateId({ model: "location" });
  const locationIds = [webLocationId, mobileLocationId];
  const productId = generateId({ model: "product" });
  const variantId = generateId({ model: "variant" });
  await setupDb.insert(tables.location).values([
    { id: webLocationId, merchantId, name: "Water 7", allowBackorders: true, nextSaleNumber: 42 },
    { id: mobileLocationId, merchantId, name: "Dressrosa", allowBackorders: false, nextSaleNumber: 42 },
  ]);
  await setupDb.insert(tables.product).values({
    id: productId,
    merchantId,
    name: "Nami's mandarins",
    slug: productId,
    type: "item",
    status: "active",
    price: "100.00",
    unitCost: "50.00",
  });
  await setupDb
    .insert(tables.variant)
    .values({ id: variantId, merchantId, productId, name: "Mandarin crate", price: "100.00" });
  await setupDb.insert(tables.inventoryLevel).values(
    locationIds.map((locationId) => ({
      id: generateId({ model: "inventoryLevel" }),
      merchantId,
      locationId,
      variantId,
      onHand: 2,
    })),
  );
  const inventoryBefore = await setupDb
    .select()
    .from(tables.inventoryLevel)
    .where(eq(tables.inventoryLevel.variantId, variantId))
    .orderBy(tables.inventoryLevel.id);
  const productsBefore = await setupDb.select().from(tables.product).where(eq(tables.product.id, productId));

  return {
    environment: { webLocationId, mobileLocationId, pendingVariantId: variantId },
    async cleanup() {
      await db.transaction(async (transaction) => {
        const sales = await transaction
          .select({ id: tables.sale.id })
          .from(tables.sale)
          .where(inArray(tables.sale.locationId, locationIds));
        const saleIds = sales.map((sale) => sale.id);
        if (saleIds.length > 0) {
          await transaction
            .delete(tables.inventoryMovement)
            .where(inArray(tables.inventoryMovement.referenceId, saleIds));
          await transaction.delete(tables.salePayment).where(inArray(tables.salePayment.saleId, saleIds));
          await transaction.delete(tables.saleItem).where(inArray(tables.saleItem.saleId, saleIds));
          await transaction.delete(tables.sale).where(inArray(tables.sale.id, saleIds));
        }
        await transaction.delete(tables.inventoryLevel).where(eq(tables.inventoryLevel.variantId, variantId));
        await transaction.delete(tables.variant).where(eq(tables.variant.id, variantId));
        await transaction.delete(tables.product).where(eq(tables.product.id, productId));
        await transaction.delete(tables.location).where(inArray(tables.location.id, locationIds));
        if (!account) {
          await transaction.delete(tables.employee).where(eq(tables.employee.accountId, accountId));
          await transaction.delete(tables.account).where(eq(tables.account.id, accountId));
          await transaction.delete(tables.merchant).where(eq(tables.merchant.id, merchantId));
        }
      });
    },
    async verify() {
      assert.deepEqual(
        await db
          .select()
          .from(tables.inventoryLevel)
          .where(eq(tables.inventoryLevel.variantId, variantId))
          .orderBy(tables.inventoryLevel.id),
        inventoryBefore,
      );
      assert.deepEqual(await db.select().from(tables.product).where(eq(tables.product.id, productId)), productsBefore);
      const sales = await db.select().from(tables.sale).where(inArray(tables.sale.locationId, locationIds));
      assert.equal(sales.length, 3);
      assert.deepEqual(
        sales.filter((sale) => sale.locationId === webLocationId).map((sale) => sale.transactionNumber),
        [42],
      );
      assert.deepEqual(
        sales
          .filter((sale) => sale.locationId === mobileLocationId)
          .map((sale) => sale.transactionNumber)
          .sort(),
        [42, 43],
      );
      for (const sale of sales) {
        assert.equal(sale.status, "pending");
        const items = await db.select().from(tables.saleItem).where(eq(tables.saleItem.saleId, sale.id));
        assert.equal(items.length, 1);
        assert.equal(items[0]!.variantId, variantId);
        assert.equal(items[0]!.quantity, 5);
        assert.equal(items[0]!.shortageQuantity, 3);
        const payments = await db.select().from(tables.salePayment).where(eq(tables.salePayment.saleId, sale.id));
        assert.equal(payments.length, 1);
        assert.equal(payments[0]!.amount, "500.00");
        assert.equal(payments[0]!.method, "cash");
      }
      assert.equal(
        (
          await db
            .select()
            .from(tables.inventoryMovement)
            .where(
              inArray(
                tables.inventoryMovement.referenceId,
                sales.map((sale) => sale.id),
              ),
            )
        ).length,
        0,
      );
      const locations = await db.select().from(tables.location).where(inArray(tables.location.id, locationIds));
      assert.equal(locations.find((location) => location.id === webLocationId)?.nextSaleNumber, 43);
      assert.equal(locations.find((location) => location.id === mobileLocationId)?.nextSaleNumber, 44);
    },
  };
}
