import { eq } from "drizzle-orm";
import { createDrizzle } from "../../../src/db/index.ts";
import { tables } from "../../../src/db/schema.ts";

export default async function cleanupProductImageFixture(_step: unknown, captures: Record<string, unknown>) {
  const productId = captures["productId"];
  if (typeof productId !== "string") {
    return {};
  }

  const db = createDrizzle(process.env["DB_URL"]!);
  await db
    .transaction(async (trx) => {
      await trx.delete(tables.variant).where(eq(tables.variant.productId, productId));
      await trx.delete(tables.product).where(eq(tables.product.id, productId));
    })
    .finally(() => db.$client.promise().end());
  return {};
}
