import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../../contracts/business-error.ts";
import type { CurrentUser } from "../../../contracts/current-user.ts";
import { Decimal, PositiveDecimal } from "../../../contracts/decimal.ts";
import { ObjectId } from "../../../contracts/object-id.ts";
import { ProductImageUrlInput } from "../../../contracts/product-image.ts";
import type { Product } from "../../../contracts/product.ts";
import type { Database } from "../../../db/index.ts";
import { tables } from "../../../db/schema.ts";
import type { CollectionFinder } from "../../../finders/collection-finder.ts";
import type { ProductFinder } from "../../../finders/product-finder.ts";
import type { ProductImageStore } from "../../../integrations/product-image-store.ts";
import type { RealtimeEventPublisher } from "../../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../../utils/assert-found.ts";
import { isPositive, lessThan, subtract } from "../../../utils/decimal.ts";
import { generateId } from "../../../utils/generate-id.ts";
import { hasDefinedValues } from "../../../utils/has-defined-values.ts";
import { now } from "../../../utils/now.ts";
import { err, ok, type Result } from "../../../utils/result.ts";
import { BaseService } from "../../base-service.ts";
import type { EmployeeManagement } from "../../employee-management.ts";
import {
  InventoryLevelInput,
  type InventoryManagement,
  type ResolvedInventoryLevel,
} from "../../inventory-management.ts";

const UpdateProductRequest = z.object({
  name: z.string().trim().nonempty().max(128).optional(),
  barcode: z.string().trim().nonempty().max(128).nullish(),
  sku: z.string().trim().nonempty().max(128).nullish(),
  price: PositiveDecimal.optional(),
  unitCost: Decimal.optional(),
  collectionId: ObjectId.nullish(),
  imageUrl: ProductImageUrlInput.nullish(),
  inventoryLevels: z.array(InventoryLevelInput).optional(),
  createdById: ObjectId.nullish(),
});

type UpdateProductRequest = z.infer<typeof UpdateProductRequest>;

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  publisher: RealtimeEventPublisher;
  collectionFinder: CollectionFinder;
  productFinder: ProductFinder;
  productImageStore: ProductImageStore;
  employeeManagement: EmployeeManagement;
  inventoryManagement: InventoryManagement;
  user: CurrentUser;
};

class UpdateProductService extends BaseService<[string, UpdateProductRequest], Product> {
  private readonly db: Database;
  private readonly publisher: RealtimeEventPublisher;
  private readonly collectionFinder: CollectionFinder;
  private readonly productFinder: ProductFinder;
  private readonly productImageStore: ProductImageStore;
  private readonly employeeManagement: EmployeeManagement;
  private readonly inventoryManagement: InventoryManagement;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    collectionFinder: CollectionFinder,
    productFinder: ProductFinder,
    productImageStore: ProductImageStore,
    publisher: RealtimeEventPublisher,
    employeeManagement: EmployeeManagement,
    inventoryManagement: InventoryManagement,
    user: CurrentUser,
  ) {
    super(logger);
    this.db = db;
    this.publisher = publisher;
    this.collectionFinder = collectionFinder;
    this.productFinder = productFinder;
    this.productImageStore = productImageStore;
    this.employeeManagement = employeeManagement;
    this.inventoryManagement = inventoryManagement;
    this.user = user;
  }

  static create({
    logger,
    db,
    collectionFinder,
    productFinder,
    productImageStore,
    publisher,
    employeeManagement,
    inventoryManagement,
    user,
  }: InjectedDependencies): UpdateProductService {
    return new UpdateProductService(
      logger,
      db,
      collectionFinder,
      productFinder,
      productImageStore,
      publisher,
      employeeManagement,
      inventoryManagement,
      user,
    );
  }

  async execute([id, request]: [string, UpdateProductRequest]): Promise<Result<Product, BusinessError>> {
    if (request.imageUrl && this.productImageStore.isManagedUrl(request.imageUrl)) {
      return err({
        code: codes.validationError,
        message: "Verify a product image upload before using an image from managed storage.",
        details: [],
      });
    }

    const creditedEmployee = await this.employeeManagement.resolveCreditedEmployeeId(this.db, {
      merchantId: this.user.merchantId,
      requestedEmployeeId: request.createdById,
      defaultEmployeeId: this.user.employeeId,
    });
    if (!creditedEmployee.success) {
      return creditedEmployee;
    }

    const product = await this.productFinder.find(this.db, { id, merchantId: this.user.merchantId });
    if (!product) {
      return err({
        code: codes.resourceNotFound,
        message: `Product ${id} has not been found.`,
        details: [],
      });
    }

    const result = await (product.productType === "item"
      ? this.updateItem(product, request, creditedEmployee.value)
      : this.updateService(product, request));
    if (result.success) {
      this.publisher.broadcast({
        merchantId: this.user.merchantId,
        resource: { type: "product", snapshot: result.value },
      });
    }

    return result;
  }

  private async updateService(
    product: Product,
    request: UpdateProductRequest,
  ): Promise<Result<Product, BusinessError>> {
    const collectionExists = request.collectionId
      ? await this.collectionFinder.exists(this.db, { merchantId: this.user.merchantId, id: request.collectionId })
      : false;

    if (request.collectionId && !collectionExists) {
      return err({
        code: codes.resourceNotFound,
        message: `Collection ${request.collectionId} has not been found.`,
        details: [],
      });
    }

    const productValues: Partial<typeof tables.product.$inferInsert> = {
      name: request.name,
      price: request.price,
      collectionId: request.collectionId,
    };

    if (!hasDefinedValues(productValues) && request.imageUrl === undefined) {
      this.logger.info({ id: product.id }, `No fields to update for resource ${product.id}`);
      return ok(product);
    }

    productValues.updatedAt = now();

    const variantValues: Partial<typeof tables.variant.$inferInsert> = {
      name: request.name,
      price: request.price,
    };

    const archivedImageValues: Partial<typeof tables.productImage.$inferInsert> = {
      archivedAt: now(),
    };

    const imageValues: typeof tables.productImage.$inferInsert | null = request.imageUrl
      ? {
          id: generateId({ model: "img" }),
          merchantId: this.user.merchantId,
          productId: product.id,
          source: "remote",
          remoteUrl: request.imageUrl,
          status: "available",
          activatedAt: now(),
        }
      : null;

    return this.db.transaction(async (trx) => {
      await trx
        .update(tables.product)
        .set(productValues)
        .where(and(eq(tables.product.id, product.id), eq(tables.product.merchantId, this.user.merchantId)));

      if (hasDefinedValues(variantValues)) {
        await trx
          .update(tables.variant)
          .set(variantValues)
          .where(and(eq(tables.variant.productId, product.id), eq(tables.variant.merchantId, this.user.merchantId)));
      }

      if (request.imageUrl !== undefined) {
        await trx
          .update(tables.productImage)
          .set(archivedImageValues)
          .where(
            and(
              eq(tables.productImage.productId, product.id),
              eq(tables.productImage.merchantId, this.user.merchantId),
              isNull(tables.productImage.archivedAt),
            ),
          );

        if (imageValues) {
          await trx.insert(tables.productImage).values(imageValues);
        }
      }

      const updatedProduct = await assertFound(
        this.productFinder.find(trx, { merchantId: this.user.merchantId, id: product.id }),
      );

      return ok(updatedProduct);
    });
  }

  private async updateItem(
    product: Product,
    request: UpdateProductRequest,
    creditedEmployeeId: string,
  ): Promise<Result<Product, BusinessError>> {
    // The credited employee only labels inventory movements, so it is not a change on its own.
    if (!hasDefinedValues({ ...request, createdById: undefined })) {
      this.logger.info({ id: product.id }, `No fields to update for resource ${product.id}`);
      return ok(product);
    }

    if (request.unitCost !== undefined && !isPositive(request.unitCost)) {
      return err({
        code: codes.validationError,
        message: "Provide a unit cost greater than zero for items.",
        details: [],
      });
    }

    const collectionExists = request.collectionId
      ? await this.collectionFinder.exists(this.db, { merchantId: this.user.merchantId, id: request.collectionId })
      : false;

    if (request.collectionId && !collectionExists) {
      return err({
        code: codes.resourceNotFound,
        message: `Collection ${request.collectionId} has not been found.`,
        details: [],
      });
    }

    const productValues: Partial<typeof tables.product.$inferInsert> = {
      name: request.name,
      price: request.price,
      unitCost: request.unitCost,
      collectionId: request.collectionId,
      updatedAt: now(),
    };

    const variantValues: Partial<typeof tables.variant.$inferInsert> = {
      name: request.name,
      price: request.price,
      sku: request.sku,
      barcode: request.barcode,
    };

    const archivedImageValues: Partial<typeof tables.productImage.$inferInsert> = {
      archivedAt: now(),
    };

    const imageValues: typeof tables.productImage.$inferInsert | null = request.imageUrl
      ? {
          id: generateId({ model: "img" }),
          merchantId: this.user.merchantId,
          productId: product.id,
          source: "remote",
          remoteUrl: request.imageUrl,
          status: "available",
          activatedAt: now(),
        }
      : null;

    if (request.sku !== undefined && request.sku !== null) {
      const duplicateSku = await this.productFinder.exists(this.db, {
        merchantId: this.user.merchantId,
        sku: request.sku,
      });

      if (duplicateSku && request.sku !== product.variants[0].sku) {
        return err({
          code: codes.skuAlreadyExists,
          message: "This SKU is already in use. Choose another SKU.",
          details: [],
        });
      }
    }

    if (request.barcode !== undefined && request.barcode !== null) {
      const duplicateBarcode = await this.productFinder.exists(this.db, {
        merchantId: this.user.merchantId,
        barcode: request.barcode,
      });

      if (duplicateBarcode && request.barcode !== product.variants[0].barcode) {
        return err({
          code: codes.barcodeAlreadyExists,
          message: "This barcode is already in use. Choose another barcode.",
          details: [],
        });
      }
    }

    return await this.db.transaction(async (trx) => {
      const [currentProduct] = await trx
        .select({
          price: tables.product.price,
          unitCost: tables.product.unitCost,
          status: tables.product.status,
          updatedAt: tables.product.updatedAt,
        })
        .from(tables.product)
        .where(and(eq(tables.product.id, product.id), eq(tables.product.merchantId, this.user.merchantId)))
        .for("update");

      if (!currentProduct) {
        return err({
          code: codes.resourceNotFound,
          message: `Product ${product.id} has not been found.`,
          details: [],
        });
      }

      const unitCostChanged =
        request.unitCost !== undefined && subtract(request.unitCost, currentProduct.unitCost) !== "0";

      const [inventoryMovement] = unitCostChanged
        ? await trx
            .select({ id: tables.inventoryLevel.id })
            .from(tables.inventoryLevel)
            .innerJoin(
              tables.variant,
              and(
                eq(tables.variant.id, tables.inventoryLevel.variantId),
                eq(tables.variant.merchantId, this.user.merchantId),
              ),
            )
            .where(
              and(
                eq(tables.inventoryLevel.merchantId, this.user.merchantId),
                eq(tables.variant.productId, product.id),
                isNotNull(tables.inventoryLevel.lastInventoryAdjustmentAt),
              ),
            )
            .limit(1)
        : [];

      if (inventoryMovement) {
        return err({
          code: codes.validationError,
          message: "The unit cost cannot be changed after an inventory movement.",
          details: [],
        });
      }

      if (lessThan(request.price ?? currentProduct.price, request.unitCost ?? currentProduct.unitCost)) {
        return err({
          code: codes.priceBelowUnitCost,
          message: "The price must be equal to or greater than the unit cost.",
          details: [],
        });
      }

      const inventoryLevels = request.inventoryLevels
        ? await this.inventoryManagement.resolveInventoryLevels(trx, {
            merchantId: this.user.merchantId,
            variantId: product.variants[0].id,
            inventoryLevels: request.inventoryLevels,
          })
        : ok<Array<ResolvedInventoryLevel>>([]);

      if (!inventoryLevels.success) {
        return inventoryLevels;
      }

      const updatedAt = now();
      const nextUpdatedAt = new Date(Math.max(updatedAt.getTime(), currentProduct.updatedAt.getTime() + 1));
      const hasInitialStock = inventoryLevels.value.some((inventoryLevel) => inventoryLevel.initialStock > 0);
      await trx
        .update(tables.product)
        .set({
          ...productValues,
          ...(hasInitialStock ? { lastRestockAt: updatedAt } : {}),
          // Opening stock initializes the item, which puts a draft on sale without reviving an archived one.
          ...(hasInitialStock && currentProduct.status === "draft" ? { status: "active" as const } : {}),
          updatedAt: nextUpdatedAt,
        })
        .where(and(eq(tables.product.id, product.id), eq(tables.product.merchantId, this.user.merchantId)));

      if (hasDefinedValues(variantValues)) {
        await trx
          .update(tables.variant)
          .set(variantValues)
          .where(and(eq(tables.variant.productId, product.id), eq(tables.variant.merchantId, this.user.merchantId)));
      }

      await this.inventoryManagement.saveInventoryLevels(trx, {
        merchantId: this.user.merchantId,
        variantId: product.variants[0].id,
        unitCost: request.unitCost ?? currentProduct.unitCost,
        createdById: creditedEmployeeId,
        occurredAt: updatedAt,
        inventoryLevels: inventoryLevels.value,
      });

      if (request.imageUrl !== undefined) {
        await trx
          .update(tables.productImage)
          .set(archivedImageValues)
          .where(
            and(
              eq(tables.productImage.productId, product.id),
              eq(tables.productImage.merchantId, this.user.merchantId),
              isNull(tables.productImage.archivedAt),
            ),
          );

        if (imageValues) {
          await trx.insert(tables.productImage).values(imageValues);
        }
      }

      const updatedProduct = await assertFound(
        this.productFinder.find(trx, { merchantId: this.user.merchantId, id: product.id }),
      );

      return ok(updatedProduct);
    });
  }
}

export { UpdateProductRequest, UpdateProductService };
