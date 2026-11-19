import { ExponentialBackoff, fallback, handleWhen, retry } from "cockatiel";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import { ObjectId } from "../../contracts/object-id.ts";
import type { Sale } from "../../contracts/sale.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { SaleFinder } from "../../finders/sale-finder.ts";
import type { RealtimeEventPublisher } from "../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../utils/assert-found.ts";
import { ConcurrentUpdateError, isConcurrentUpdateError } from "../../utils/concurrent-update-error.ts";
import { generateId } from "../../utils/generate-id.ts";
import { now } from "../../utils/now.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { splitDistinct } from "../../utils/split-distinct.ts";
import { BaseService } from "../base-service.ts";
import type { EmployeeManagement } from "../staff/employees/employee-management.ts";

const VoidSaleRequest = z.object({
  reason: z
    .string()
    .trim()
    .max(256)
    .nullish()
    .transform((reason) => reason || null)
    .optional(),
  voidedById: ObjectId.nullish(),
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
  publisher: RealtimeEventPublisher;
  saleFinder: SaleFinder;
  user: CurrentUser;
  employeeManagement: EmployeeManagement;
};

class VoidSaleService extends BaseService<string, Sale> {
  private readonly db: Database;
  private readonly employeeManagement: EmployeeManagement;
  private readonly publisher: RealtimeEventPublisher;
  private readonly saleFinder: SaleFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    saleFinder: SaleFinder,
    publisher: RealtimeEventPublisher,
    user: CurrentUser,
    employeeManagement: EmployeeManagement,
  ) {
    super(logger);
    this.db = db;
    this.employeeManagement = employeeManagement;
    this.publisher = publisher;
    this.saleFinder = saleFinder;
    this.user = user;
  }

  static create({
    logger,
    db,
    saleFinder,
    publisher,
    user,
    employeeManagement,
  }: InjectedDependencies): VoidSaleService {
    return new VoidSaleService(logger, db, saleFinder, publisher, user, employeeManagement);
  }

  async execute(id: string, request: VoidSaleRequest = {}): Promise<Result<Sale, BusinessError>> {
    const voidSaleWithRetry = () =>
      VOID_SALE_RETRY_POLICY.execute(() => this.voidSale(id, request.reason ?? null, request.voidedById));
    const result = await VOID_SALE_FALLBACK_POLICY.execute(voidSaleWithRetry);
    if (result.success) {
      this.publisher.broadcast({
        merchantId: this.user.merchantId,
        resource: { type: "sale", snapshot: result.value },
      });
    }

    return result;
  }

  private async voidSale(
    id: string,
    reason: string | null,
    voidedById: string | null | undefined,
  ): Promise<Result<Sale, BusinessError>> {
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
      if (!permissions.includes("void_transaction")) {
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

    const creditedEmployee = await this.employeeManagement.resolveCreditedEmployeeId(this.db, {
      merchantId: this.user.merchantId,
      requestedEmployeeId: voidedById,
      defaultEmployeeId: employee.id,
    });
    if (!creditedEmployee.success) {
      return creditedEmployee;
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
            .set({
              updatedAt: new Date(Math.max(voidedAt.getTime(), product.updatedAt.getTime() + 1)),
            })
            .where(
              and(
                eq(tables.product.merchantId, this.user.merchantId),
                eq(tables.product.id, product.id),
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
            .set({
              onHand: sql`${tables.inventoryLevel.onHand} + ${line.quantity}`,
              lastInventoryAdjustmentAt: voidedAt,
              updatedAt: voidedAt,
            })
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
          .set({
            status: "voided",
            voidReason: reason,
            voidedById: creditedEmployee.value,
            voidedAt,
            updatedAt: voidedAt,
          })
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
              createdById: creditedEmployee.value,
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
