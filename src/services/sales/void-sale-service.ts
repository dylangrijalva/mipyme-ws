import { ExponentialBackoff, fallback, handleWhen, retry } from "cockatiel";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Sale } from "../../contracts/sale.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { SaleFinder } from "../../finders/sale-finder.ts";
import { assertFound } from "../../utils/assert-found.ts";
import { ConcurrentUpdateError, isConcurrentUpdateError } from "../../utils/concurrent-update-error.ts";
import { generateId } from "../../utils/generate-id.ts";
import { now } from "../../utils/now.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { splitDistinct } from "../../utils/split-distinct.ts";
import { BaseService } from "../base-service.ts";

const VoidSaleRequest = z.object({
  reason: z
    .string()
    .trim()
    .max(256)
    .nullish()
    .transform((reason) => reason || null)
    .optional(),
});

type VoidSaleRequest = z.infer<typeof VoidSaleRequest>;

const VOID_SALE_RETRY_POLICY = retry(handleWhen(isConcurrentUpdateError), {
  maxAttempts: 2,
  backoff: new ExponentialBackoff({
    initialDelay: 25,
    maxDelay: 100,
  }),
});

const VOID_SALE_FALLBACK_POLICY = fallback(handleWhen(isConcurrentUpdateError), () =>
  err({
    code: codes.concurrentUpdateConflict,
    message: "Inventory changed while the sale was being voided. Retry the request.",
    details: [],
  }),
);

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  user: CurrentUser;
  saleFinder: SaleFinder;
};

class VoidSaleService extends BaseService<string, Sale> {
  private readonly db: Database;
  private readonly user: CurrentUser;
  private readonly saleFinder: SaleFinder;

  constructor(logger: Logger, db: Database, user: CurrentUser, saleFinder: SaleFinder) {
    super(logger);
    this.db = db;
    this.user = user;
    this.saleFinder = saleFinder;
  }

  static create({ logger, db, user, saleFinder }: InjectedDependencies): VoidSaleService {
    return new VoidSaleService(logger, db, user, saleFinder);
  }

  async execute(id: string, request: VoidSaleRequest = {}): Promise<Result<Sale, BusinessError>> {
    const voidSaleWithRetry = () => VOID_SALE_RETRY_POLICY.execute(() => this.voidSale(id, request.reason ?? null));
    return VOID_SALE_FALLBACK_POLICY.execute(voidSaleWithRetry);
  }

  private async voidSale(id: string, reason: string | null): Promise<Result<Sale, BusinessError>> {
    const [employee] = await this.db
      .select()
      .from(tables.employee)
      .where(and(eq(tables.employee.id, this.user.employeeId), eq(tables.employee.merchantId, this.user.merchantId)))
      .limit(1);

    if (!employee || employee.status !== "enabled") {
      return err({
        code: codes.forbiddenError,
        message: "You do not have permission to void sales.",
        details: [],
      });
    }

    const [sale] = await this.db
      .select()
      .from(tables.sale)
      .where(and(eq(tables.sale.id, id), eq(tables.sale.merchantId, this.user.merchantId)))
      .limit(1);

    if (!sale) {
      return err({
        code: codes.resourceNotFound,
        message: "The sale has not been found.",
        details: [],
      });
    }

    if (!employee.isOwner) {
      const permissions = splitDistinct(employee.permissions, " ");
      if (!permissions.includes("void_sales")) {
        return err({
          code: codes.forbiddenError,
          message: "You do not have permission to void sales.",
          details: [],
        });
      }

      const [access] = await this.db
        .select({ id: tables.locationAccess.id })
        .from(tables.locationAccess)
        .where(
          and(
            eq(tables.locationAccess.merchantId, this.user.merchantId),
            eq(tables.locationAccess.employeeId, employee.id),
            eq(tables.locationAccess.locationId, sale.locationId),
          ),
        )
        .limit(1);

      if (!access) {
        return err({
          code: codes.forbiddenError,
          message: "You do not have access to this location.",
          details: [],
        });
      }
    }

    if (sale.status === "voided") {
      return ok(await assertFound(this.saleFinder.find(this.db, { id: sale.id, merchantId: this.user.merchantId })));
    }

    if (sale.status !== "fulfilled") {
      return err({
        code: codes.validationError,
        message: "Only fulfilled sales can be voided.",
        details: [],
      });
    }

    const saleItems = await this.db
      .select()
      .from(tables.saleItem)
      .where(and(eq(tables.saleItem.saleId, sale.id), eq(tables.saleItem.merchantId, this.user.merchantId)));

    const variantDetails = await this.db
      .select({
        variantId: tables.variant.id,
        productId: tables.product.id,
        productType: tables.product.type,
      })
      .from(tables.variant)
      .innerJoin(
        tables.product,
        and(eq(tables.product.id, tables.variant.productId), eq(tables.product.merchantId, this.user.merchantId)),
      )
      .where(
        and(
          eq(tables.variant.merchantId, this.user.merchantId),
          inArray(
            tables.variant.id,
            saleItems.map((item) => item.variantId),
          ),
        ),
      );
    const variantDetailsById = new Map(variantDetails.map((variant) => [variant.variantId, variant]));

    if (variantDetails.length !== saleItems.length) {
      throw new ConcurrentUpdateError();
    }

    const lines = saleItems.map((item) => {
      const variant = variantDetailsById.get(item.variantId);
      if (!variant) {
        throw new ConcurrentUpdateError();
      }

      return { ...item, ...variant };
    });

    const physicalLines = lines.filter((line) => line.productType === "item");
    const productIds = [...new Set(physicalLines.map((line) => line.productId))].sort();
    const products = productIds.length
      ? await this.db
          .select()
          .from(tables.product)
          .where(and(eq(tables.product.merchantId, this.user.merchantId), inArray(tables.product.id, productIds)))
          .orderBy(asc(tables.product.id))
      : [];

    if (products.length !== productIds.length) {
      throw new ConcurrentUpdateError();
    }

    const hasRestockedProduct = products.some(
      (product) => product.lastRestockAt !== null && product.lastRestockAt.getTime() >= sale.createdAt.getTime(),
    );
    if (hasRestockedProduct) {
      return err({
        code: codes.validationError,
        message: "A sale cannot be voided after one of its products has been restocked.",
        details: [],
      });
    }

    const inventoryLevels = physicalLines.length
      ? await this.db
          .select()
          .from(tables.inventoryLevel)
          .where(
            and(
              eq(tables.inventoryLevel.merchantId, this.user.merchantId),
              eq(tables.inventoryLevel.locationId, sale.locationId),
              inArray(
                tables.inventoryLevel.variantId,
                physicalLines.map((line) => line.variantId),
              ),
            ),
          )
          .orderBy(asc(tables.inventoryLevel.variantId))
      : [];
    const inventoryLevelsByVariantId = new Map(inventoryLevels.map((level) => [level.variantId, level]));

    if (inventoryLevels.length !== physicalLines.length) {
      throw new ConcurrentUpdateError();
    }

    return this.db.transaction(
      async (trx): Promise<Result<Sale, BusinessError>> => {
        const voidedAt = now();
        for (const product of products) {
          const [updatedProduct] = await trx
            .update(tables.product)
            .set({ inventoryVersion: sql`${tables.product.inventoryVersion} + 1`, updatedAt: voidedAt })
            .where(
              and(
                eq(tables.product.merchantId, this.user.merchantId),
                eq(tables.product.id, product.id),
                eq(tables.product.inventoryVersion, product.inventoryVersion),
                eq(tables.product.updatedAt, product.updatedAt),
                or(isNull(tables.product.lastRestockAt), lt(tables.product.lastRestockAt, sale.createdAt)),
              ),
            );

          if (updatedProduct.affectedRows !== 1) {
            throw new ConcurrentUpdateError();
          }
        }

        for (const line of physicalLines) {
          const level = inventoryLevelsByVariantId.get(line.variantId);
          if (!level) {
            throw new ConcurrentUpdateError();
          }

          const [updatedLevel] = await trx
            .update(tables.inventoryLevel)
            .set({ onHand: sql`${tables.inventoryLevel.onHand} + ${line.quantity}`, updatedAt: voidedAt })
            .where(
              and(
                eq(tables.inventoryLevel.merchantId, this.user.merchantId),
                eq(tables.inventoryLevel.id, level.id),
                eq(tables.inventoryLevel.onHand, level.onHand),
                eq(tables.inventoryLevel.updatedAt, level.updatedAt),
              ),
            );

          if (updatedLevel.affectedRows !== 1) {
            throw new ConcurrentUpdateError();
          }
        }

        const [updatedSale] = await trx
          .update(tables.sale)
          .set({ status: "voided", voidReason: reason, voidedById: employee.id, voidedAt, updatedAt: voidedAt })
          .where(
            and(
              eq(tables.sale.id, sale.id),
              eq(tables.sale.merchantId, this.user.merchantId),
              eq(tables.sale.status, "fulfilled"),
              eq(tables.sale.updatedAt, sale.updatedAt),
            ),
          );

        if (updatedSale.affectedRows !== 1) {
          throw new ConcurrentUpdateError();
        }

        if (physicalLines.length) {
          await trx.insert(tables.inventoryMovement).values(
            physicalLines.map((line) => ({
              id: generateId({ model: "inventoryMovement" }),
              merchantId: this.user.merchantId,
              inventoryLevelId: inventoryLevelsByVariantId.get(line.variantId)!.id,
              referenceId: sale.id,
              reason: "sale_void" as const,
              fromState: "sold" as const,
              toState: "in_stock" as const,
              quantityDelta: line.quantity,
              unitCost: line.unitCost,
              createdById: employee.id,
              occurredAt: voidedAt,
              createdAt: voidedAt,
              updatedAt: voidedAt,
            })),
          );
        }

        return ok(await assertFound(this.saleFinder.find(trx, { id: sale.id, merchantId: this.user.merchantId })));
      },
      { isolationLevel: "read committed" },
    );
  }
}

export { VoidSaleRequest, VoidSaleService };
