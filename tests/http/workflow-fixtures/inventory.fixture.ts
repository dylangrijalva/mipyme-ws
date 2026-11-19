import { inArray } from "drizzle-orm";
import { createDrizzle } from "../../../src/db/index.ts";
import { tables } from "../../../src/db/schema.ts";

// Workflows share one merchant, so the products created here are removed to leave later workflows the catalog they expect.
export default async function cleanupInventoryFixture(_step: unknown, captures: Record<string, unknown>) {
  const productIds = [captures["tangerinesId"], captures["tabascoId"]].filter(
    (productId): productId is string => typeof productId === "string",
  );
  // A silent no-op would leave products behind and break the next workflow's catalog assertions.
  if (productIds.length !== 2) {
    throw new Error("The inventory workflow did not capture the products it created, so they cannot be removed.");
  }

  const db = createDrizzle(process.env["DB_URL"]!);
  await db
    .transaction(async (trx) => {
      const variants = await trx
        .select({ id: tables.variant.id })
        .from(tables.variant)
        .where(inArray(tables.variant.productId, productIds));
      const variantIds = variants.map((variant) => variant.id);
      const levels = variantIds.length
        ? await trx
            .select({ id: tables.inventoryLevel.id })
            .from(tables.inventoryLevel)
            .where(inArray(tables.inventoryLevel.variantId, variantIds))
        : [];
      const levelIds = levels.map((level) => level.id);

      if (levelIds.length > 0) {
        await trx.delete(tables.inventoryMovement).where(inArray(tables.inventoryMovement.inventoryLevelId, levelIds));
        await trx.delete(tables.inventoryLevel).where(inArray(tables.inventoryLevel.id, levelIds));
      }

      if (variantIds.length > 0) {
        await trx.delete(tables.variant).where(inArray(tables.variant.id, variantIds));
      }

      await trx.delete(tables.product).where(inArray(tables.product.id, productIds));
    })
    .finally(() => db.$client.promise().end());
  return {};
}
