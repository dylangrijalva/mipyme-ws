import Big from "big.js";
import { ExponentialBackoff, fallback, handleWhen, retry } from "cockatiel";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import { Decimal, PositiveDecimal } from "../../contracts/decimal.ts";
import { ObjectId } from "../../contracts/object-id.ts";
import { PaymentMethod } from "../../contracts/payment-method.ts";
import type { Sale } from "../../contracts/sale.ts";
import { Source } from "../../contracts/source.ts";
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
import { EmployeeAuthorizationService } from "../employee-authorization-service.ts";

const CreateSaleRequest = z.object({
  source: Source.default("pos.web"),
  locationId: ObjectId,
  businessDate: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  customerId: ObjectId.nullish(),
  notes: z.string().trim().max(256).nullish(),
  discountRate: Decimal.pipe(
    z.string().refine((value) => new Big(value).lte(1), "Discount rate must be between 0.00 and 1.00."),
  ).nullish(),
  lineItems: z
    .array(z.object({ variantId: ObjectId, price: Decimal, quantity: z.number().int().positive() }))
    .min(1, { message: "At least one line item is required." }),
  payments: z.array(
    z.object({
      method: PaymentMethod,
      amount: PositiveDecimal,
    }),
  ),
});

type CreateSaleRequest = z.infer<typeof CreateSaleRequest>;

const CREATE_SALE_RETRY_POLICY = retry(handleWhen(isConcurrentUpdateError), {
  maxAttempts: 2,
  backoff: new ExponentialBackoff({
    initialDelay: 25,
    maxDelay: 100,
  }),
});

const CREATE_SALE_FALLBACK_POLICY = fallback(handleWhen(isConcurrentUpdateError), () =>
  err({
    code: codes.concurrentUpdateConflict,
    message: "Inventory or the sale number changed while the sale was being created. Retry the request.",
    details: [],
  }),
);

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  publisher: RealtimeEventPublisher;
  saleFinder: SaleFinder;
  user: CurrentUser;
};

class CreateSaleService extends BaseService<CreateSaleRequest, Sale> {
  private readonly db: Database;
  private readonly publisher: RealtimeEventPublisher;
  private readonly saleFinder: SaleFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    saleFinder: SaleFinder,
    publisher: RealtimeEventPublisher,
    user: CurrentUser,
  ) {
    super(logger);
    this.db = db;
    this.publisher = publisher;
    this.saleFinder = saleFinder;
    this.user = user;
  }

  static create(deps: InjectedDependencies): CreateSaleService {
    return new CreateSaleService(deps.logger, deps.db, deps.saleFinder, deps.publisher, deps.user);
  }

  async execute(request: CreateSaleRequest): Promise<Result<Sale, BusinessError>> {
    const variantIds = request.lineItems.map((line) => line.variantId);
    const uniqueVariantIds = new Set(variantIds);
    const hasDuplicateVariants = uniqueVariantIds.size !== variantIds.length;

    if (hasDuplicateVariants) {
      return err({
        code: codes.validationError,
        message: "A sale cannot contain duplicate variants. Combine duplicate line items into one.",
        details: [],
      });
    }

    const createSaleWithRetry = () => CREATE_SALE_RETRY_POLICY.execute(() => this.createSale(request));

    const result = await CREATE_SALE_FALLBACK_POLICY.execute(createSaleWithRetry);
    if (result.success) {
      this.publisher.broadcast({
        merchantId: this.user.merchantId,
        resource: { type: "sale", snapshot: result.value },
      });
    }

    return result;
  }

  private async createSale(request: CreateSaleRequest): Promise<Result<Sale, BusinessError>> {
    const variantIds = request.lineItems.map((line) => line.variantId);
    const employeeAuthorization = EmployeeAuthorizationService.create({ db: this.db });
    const authorization = await employeeAuthorization.authorizePermission({
      employeeId: this.user.employeeId,
      merchantId: this.user.merchantId,
      permission: "checkout",
    });
    if (!authorization.success) {
      return err({
        code: codes.forbiddenError,
        message: "You do not have permission to checkout.",
        details: [],
      });
    }
    const employee = authorization.value;
    const permissions = splitDistinct(employee.permissions, " ");

    const locationAuthorization = await employeeAuthorization.authorizeLocationAccess({
      employee,
      locationId: request.locationId,
    });
    if (!locationAuthorization.success) {
      if (locationAuthorization.error.kind === "location_not_found") {
        return err({
          code: codes.resourceNotFound,
          message: "The location has not been found.",
          details: [],
        });
      }

      return err({
        code: codes.forbiddenError,
        message: "You do not have access to this location.",
        details: [],
      });
    }

    const variants = await this.db
      .select()
      .from(tables.variant)
      .where(and(eq(tables.variant.merchantId, this.user.merchantId), inArray(tables.variant.id, variantIds)));
    const allVariantsWereFound = variants.length === variantIds.length;
    if (!allVariantsWereFound) {
      return err({
        code: codes.resourceNotFound,
        message: "One or more variants have not been found.",
        details: [],
      });
    }

    const productIds = [...new Set(variants.map((variant) => variant.productId))].sort();
    const products = await this.db
      .select()
      .from(tables.product)
      .where(and(eq(tables.product.merchantId, this.user.merchantId), inArray(tables.product.id, productIds)))
      .orderBy(asc(tables.product.id));
    const allProductsWereFound = products.length === productIds.length;
    const allProductsAreSellable = products.every(
      (product) => product.status === "active" && product.archivedAt === null,
    );
    const allVariantsAreUnarchived = variants.every((variant) => variant.archivedAt === null);
    const lineItemsAreSellable = allProductsWereFound && allProductsAreSellable && allVariantsAreUnarchived;
    if (!lineItemsAreSellable) {
      return err({
        code: codes.validationError,
        message: "Only active products and unarchived variants can be sold.",
        details: [],
      });
    }

    const [location] = await this.db
      .select()
      .from(tables.location)
      .where(and(eq(tables.location.id, request.locationId), eq(tables.location.merchantId, this.user.merchantId)))
      .limit(1);
    if (!location) {
      return err({
        code: codes.resourceNotFound,
        message: "The location has not been found.",
        details: [],
      });
    }

    const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
    const productsById = new Map(products.map((product) => [product.id, product]));
    const lines = request.lineItems.map((line) => {
      const variant = variantsById.get(line.variantId)!;
      const product = productsById.get(variant.productId)!;
      return { ...line, variant, product };
    });

    const pricing = this.validatePricing({
      lineItems: lines.map((line) => ({
        ...line,
        catalogPrice: line.variant.price,
        unitCost: line.product.unitCost,
      })),
      payments: request.payments,
      discountRate: request.discountRate ?? "0",
      exchangeRate: location.exchangeRate,
      isOwner: employee.isOwner,
      canDiscount: permissions.includes("apply_discounts"),
      maxDiscountRate: employee.maxDiscountRate,
    });

    const pricingIsInvalid = !pricing.success;
    if (pricingIsInvalid) {
      return pricing;
    }

    const customerId = request.customerId;
    const hasCustomer = customerId !== null && customerId !== undefined;
    if (hasCustomer) {
      const [customer] = await this.db
        .select({ id: tables.customer.id })
        .from(tables.customer)
        .where(and(eq(tables.customer.id, customerId), eq(tables.customer.merchantId, this.user.merchantId)))
        .limit(1);
      if (!customer) {
        return err({
          code: codes.resourceNotFound,
          message: "The customer has not been found.",
          details: [],
        });
      }
    }

    const physicalLines = lines.filter((line) => line.product.type === "item");
    const hasPhysicalLines = physicalLines.length > 0;
    const inventory = hasPhysicalLines
      ? await this.db
          .select()
          .from(tables.inventoryLevel)
          .where(
            and(
              eq(tables.inventoryLevel.merchantId, this.user.merchantId),
              eq(tables.inventoryLevel.locationId, location.id),
              inArray(
                tables.inventoryLevel.variantId,
                physicalLines.map((line) => line.variantId),
              ),
            ),
          )
          .orderBy(asc(tables.inventoryLevel.variantId))
      : [];

    const inventoryByVariant = new Map(inventory.map((level) => [level.variantId, level]));
    const saleLines = lines.map((line) => {
      const isServiceLine = line.product.type === "service";
      const onHandQuantity = inventoryByVariant.get(line.variantId)?.onHand ?? 0;
      const shortageQuantity = isServiceLine ? 0 : Math.max(0, line.quantity - onHandQuantity);
      return { ...line, shortageQuantity };
    });

    const hasShortage = saleLines.some((line) => line.shortageQuantity > 0);
    const isWebSale = request.source === "pos.web";
    const backordersAreDisabled = !location.allowBackorders;
    const shortageCannotBeBackordered = hasShortage && isWebSale && backordersAreDisabled;
    if (shortageCannotBeBackordered) {
      return err({
        code: codes.stockInsufficient,
        message: "One or more items do not have enough stock at this location.",
        details: saleLines
          .filter((line) => line.shortageQuantity > 0)
          .map((line) => ({
            code: codes.stockInsufficient,
            message: `Variant ${line.variantId} is short by ${line.shortageQuantity}.`,
          })),
      });
    }

    const shouldDeductInventory = !hasShortage && hasPhysicalLines;
    const hasPayments = request.payments.length > 0;
    const saleStatus = hasShortage ? "pending" : "fulfilled";
    const saleId = generateId({ model: "sale" });

    return this.db.transaction(
      async (trx): Promise<Result<Sale, BusinessError>> => {
        const createdAt = now();

        if (shouldDeductInventory) {
          const changedProductIds = [...new Set(physicalLines.map((line) => line.product.id))].sort();
          for (const productId of changedProductIds) {
            const product = productsById.get(productId)!;
            const [updatedProduct] = await trx
              .update(tables.product)
              .set({ inventoryVersion: sql`${tables.product.inventoryVersion} + 1`, updatedAt: createdAt })
              .where(
                and(
                  eq(tables.product.merchantId, this.user.merchantId),
                  eq(tables.product.id, product.id),
                  eq(tables.product.inventoryVersion, product.inventoryVersion),
                  eq(tables.product.updatedAt, product.updatedAt),
                ),
              );

            const productWasUpdated = updatedProduct.affectedRows === 1;
            if (!productWasUpdated) {
              throw new ConcurrentUpdateError();
            }
          }

          for (const line of physicalLines) {
            const level = inventoryByVariant.get(line.variantId);
            if (!level) {
              throw new ConcurrentUpdateError();
            }

            const [updatedLevel] = await trx
              .update(tables.inventoryLevel)
              .set({ onHand: sql`${tables.inventoryLevel.onHand} - ${line.quantity}`, updatedAt: createdAt })
              .where(
                and(
                  eq(tables.inventoryLevel.merchantId, this.user.merchantId),
                  eq(tables.inventoryLevel.id, level.id),
                  eq(tables.inventoryLevel.updatedAt, level.updatedAt),
                  gte(tables.inventoryLevel.onHand, line.quantity),
                ),
              );

            const inventoryLevelWasUpdated = updatedLevel.affectedRows === 1;
            if (!inventoryLevelWasUpdated) {
              throw new ConcurrentUpdateError();
            }
          }
        }

        const [updatedLocation] = await trx
          .update(tables.location)
          .set({ nextSaleNumber: location.nextSaleNumber + 1, updatedAt: createdAt })
          .where(
            and(
              eq(tables.location.merchantId, this.user.merchantId),
              eq(tables.location.id, location.id),
              eq(tables.location.nextSaleNumber, location.nextSaleNumber),
              eq(tables.location.updatedAt, location.updatedAt),
            ),
          );

        const locationWasUpdated = updatedLocation.affectedRows === 1;
        if (!locationWasUpdated) {
          throw new ConcurrentUpdateError();
        }

        await trx.insert(tables.sale).values({
          id: saleId,
          merchantId: this.user.merchantId,
          locationId: location.id,
          source: request.source,
          businessDate: request.businessDate,
          status: saleStatus,
          transactionNumber: location.nextSaleNumber,
          discountRate: request.discountRate ?? null,
          notes: request.notes ?? null,
          customerId: request.customerId ?? null,
          createdById: employee.id,
          createdAt,
          updatedAt: createdAt,
        });
        await trx.insert(tables.saleItem).values(
          saleLines.map((line) => ({
            id: generateId({ model: "saleItem" }),
            merchantId: this.user.merchantId,
            saleId,
            variantId: line.variantId,
            name: line.variant.name,
            price: line.price,
            unitCost: line.product.unitCost,
            quantity: line.quantity,
            shortageQuantity: line.shortageQuantity,
            createdAt,
            updatedAt: createdAt,
          })),
        );
        if (hasPayments) {
          await trx.insert(tables.salePayment).values(
            request.payments.map((payment) => {
              const isCashDollarPayment = payment.method === "cash_dollar";

              return {
                id: generateId({ model: "salePayment" }),
                merchantId: this.user.merchantId,
                saleId,
                ...payment,
                exchangeRate: isCashDollarPayment ? location.exchangeRate : null,
              };
            }),
          );
        }

        if (shouldDeductInventory) {
          await trx.insert(tables.inventoryMovement).values(
            physicalLines.map((line) => ({
              id: generateId({ model: "inventoryMovement" }),
              merchantId: this.user.merchantId,
              inventoryLevelId: inventoryByVariant.get(line.variantId)!.id,
              referenceId: saleId,
              reason: "sale" as const,
              fromState: "in_stock" as const,
              toState: "sold" as const,
              quantityDelta: -line.quantity,
              unitCost: line.product.unitCost,
              createdById: employee.id,
              occurredAt: createdAt,
              createdAt,
              updatedAt: createdAt,
            })),
          );
        }

        return ok(await assertFound(this.saleFinder.find(trx, { id: saleId, merchantId: this.user.merchantId })));
      },
      { isolationLevel: "read committed" },
    );
  }

  private validatePricing(input: {
    lineItems: Array<{ variantId: string; price: string; catalogPrice: string; unitCost: string; quantity: number }>;
    payments: Array<{ method: PaymentMethod; amount: string }>;
    discountRate: string;
    exchangeRate: string;
    isOwner: boolean;
    canDiscount: boolean;
    maxDiscountRate: string;
  }): Result<void, BusinessError> {
    const discountMultiplier = new Big(1).minus(input.discountRate);
    const minimumPriceMultiplier = new Big(1).minus(input.maxDiscountRate);
    const isStaffMember = !input.isOwner;
    const hasDiscountRate = new Big(input.discountRate).gt(0);
    const lineTotals: Array<Big> = [];

    for (const line of input.lineItems) {
      const price = new Big(line.price);
      const finalPrice = price.times(discountMultiplier);
      const priceIsBelowCatalogPrice = price.lt(line.catalogPrice);
      const isDiscounted = priceIsBelowCatalogPrice || hasDiscountRate;
      const discountRequiresPermission = isStaffMember && isDiscounted && !input.canDiscount;

      if (discountRequiresPermission) {
        return err({
          code: codes.forbiddenError,
          message: "You do not have permission to apply discounts.",
          details: [],
        });
      }

      const minimumAllowedPrice = new Big(line.catalogPrice).times(minimumPriceMultiplier);
      const discountLimitIsExceeded = isStaffMember && finalPrice.lt(minimumAllowedPrice);
      if (discountLimitIsExceeded) {
        return err({
          code: codes.forbiddenError,
          message: "A line exceeds your discount limit.",
          details: [
            { code: "discount_limit_exceeded", message: `Variant ${line.variantId} exceeds your discount limit.` },
          ],
        });
      }

      const finalPriceIsBelowUnitCost = finalPrice.lt(line.unitCost);
      if (finalPriceIsBelowUnitCost) {
        return err({
          code: codes.priceBelowUnitCost,
          message: "The price after discounts must not be below unit cost.",
          details: [
            { code: codes.priceBelowUnitCost, message: `Variant ${line.variantId} is priced below unit cost.` },
          ],
        });
      }

      lineTotals.push(finalPrice.times(line.quantity).round(2, Big.roundHalfUp));
    }

    const total = lineTotals.reduce((sum, amount) => sum.plus(amount), new Big(0));
    const paid = input.payments.reduce((sum, payment) => {
      const amount = new Big(payment.amount);
      const isCashDollarPayment = payment.method === "cash_dollar";
      const convertedAmount = isCashDollarPayment ? amount.times(input.exchangeRate).round(2, Big.roundHalfUp) : amount;
      return sum.plus(convertedAmount);
    }, new Big(0));

    const paymentsMatchTotal = paid.eq(total);
    if (!paymentsMatchTotal) {
      const paymentIsInsufficient = paid.lt(total);

      return err({
        code: paymentIsInsufficient ? codes.paymentInsufficient : codes.validationError,
        message: "Payments must exactly match the sale total after discounts and currency conversion.",
        details: [],
      });
    }

    return ok(undefined);
  }
}

export { CreateSaleRequest, CreateSaleService };
