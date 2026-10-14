import { and, eq, sql } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../../contracts/business-error.ts";
import type { CurrentUser } from "../../../contracts/current-user.ts";
import { Decimal, PositiveDecimal } from "../../../contracts/decimal.ts";
import { ObjectId } from "../../../contracts/object-id.ts";
import { PRODUCT_IMAGE_URL_MAX_LENGTH } from "../../../contracts/product-image.ts";
import { ProductType } from "../../../contracts/product-type.ts";
import type { Product } from "../../../contracts/product.ts";
import type { Database } from "../../../db/index.ts";
import { tables } from "../../../db/schema.ts";
import type { CollectionFinder } from "../../../finders/collection-finder.ts";
import type { ProductFinder } from "../../../finders/product-finder.ts";
import type { RealtimeEventPublisher } from "../../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../../utils/assert-found.ts";
import { isPositive, lessThan } from "../../../utils/decimal.ts";
import { generateId } from "../../../utils/generate-id.ts";
import { now } from "../../../utils/now.ts";
import { err, ok, type Result } from "../../../utils/result.ts";
import { slugify } from "../../../utils/slugify.ts";
import { BaseService } from "../../base-service.ts";

const CreateProductRequest = z.object({
  name: z.string().trim().nonempty().max(128),
  barcode: z.string().trim().nonempty().max(128).nullish(),
  sku: z.string().trim().nonempty().max(128).nullish(),
  price: PositiveDecimal,
  unitCost: Decimal.optional(),
  collectionId: ObjectId.nullish(),
  productType: ProductType.default("item"),
  imageUrl: z
    .string()
    .trim()
    .pipe(z.url({ protocol: /^https?$/ }).max(PRODUCT_IMAGE_URL_MAX_LENGTH))
    .nullish(),
});

type CreateProductRequest = z.infer<typeof CreateProductRequest>;

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  publisher: RealtimeEventPublisher;
  collectionFinder: CollectionFinder;
  productFinder: ProductFinder;
  user: CurrentUser;
};

class CreateProductService extends BaseService<CreateProductRequest, Product> {
  private readonly db: Database;
  private readonly publisher: RealtimeEventPublisher;
  private readonly collectionFinder: CollectionFinder;
  private readonly productFinder: ProductFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    collectionFinder: CollectionFinder,
    productFinder: ProductFinder,
    publisher: RealtimeEventPublisher,
    user: CurrentUser,
  ) {
    super(logger);
    this.db = db;
    this.publisher = publisher;
    this.collectionFinder = collectionFinder;
    this.productFinder = productFinder;
    this.user = user;
  }

  static create({
    logger,
    db,
    collectionFinder,
    productFinder,
    publisher,
    user,
  }: InjectedDependencies): CreateProductService {
    return new CreateProductService(logger, db, collectionFinder, productFinder, publisher, user);
  }

  async execute(request: CreateProductRequest): Promise<Result<Product, BusinessError>> {
    const result = await (request.productType === "service" ? this.createService(request) : this.createItem(request));
    if (result.success) {
      this.publisher.broadcast({
        merchantId: this.user.merchantId,
        resource: { type: "product", snapshot: result.value },
      });
    }

    return result;
  }

  private async createService(request: CreateProductRequest): Promise<Result<Product, BusinessError>> {
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

    const productId = generateId({ model: "product" });
    const variantId = generateId({ model: "variant" });
    const slugSuffix = productId.toLowerCase();
    const slugName = (slugify(request.name) || "product").slice(0, 128 - slugSuffix.length - 1);

    const productValues: typeof tables.product.$inferInsert = {
      id: productId,
      merchantId: this.user.merchantId,
      name: request.name,
      slug: `${slugName}-${slugSuffix}`,
      price: request.price,
      unitCost: "0.00",
      type: "service",
      status: "active",
      collectionId: request.collectionId ?? null,
    };

    const variantValues: typeof tables.variant.$inferInsert = {
      id: variantId,
      merchantId: this.user.merchantId,
      productId,
      name: request.name,
      price: request.price,
      sku: null,
      barcode: null,
    };

    const imageValues: typeof tables.productImage.$inferInsert | null = request.imageUrl
      ? {
          id: generateId({ model: "img" }),
          merchantId: this.user.merchantId,
          productId,
          source: "remote",
          remoteUrl: request.imageUrl,
          status: "available",
          activatedAt: now(),
        }
      : null;

    return this.db.transaction(async (trx) => {
      await trx.insert(tables.product).values(productValues);
      await trx.insert(tables.variant).values(variantValues);

      if (imageValues) {
        await trx.insert(tables.productImage).values(imageValues);
      }

      const product = await assertFound(
        this.productFinder.find(trx, { merchantId: this.user.merchantId, id: productId }),
      );
      return ok(product);
    });
  }

  private async createItem(request: CreateProductRequest): Promise<Result<Product, BusinessError>> {
    if (request.unitCost === undefined) {
      return err({
        code: codes.validationError,
        message: "Provide a unit cost for items.",
        details: [],
      });
    }

    if (!isPositive(request.unitCost)) {
      return err({
        code: codes.validationError,
        message: "Provide a unit cost greater than zero for items.",
        details: [],
      });
    }

    if (lessThan(request.price, request.unitCost)) {
      return err({
        code: codes.priceBelowUnitCost,
        message: "The price must be equal to or greater than the unit cost.",
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

    const existingSku = request.sku
      ? await this.productFinder.exists(this.db, { merchantId: this.user.merchantId, sku: request.sku })
      : false;

    if (existingSku) {
      return err({
        code: codes.skuAlreadyExists,
        message: "This SKU is already in use. Choose another SKU.",
        details: [],
      });
    }

    const existingBarcode = request.barcode
      ? await this.productFinder.exists(this.db, { merchantId: this.user.merchantId, barcode: request.barcode })
      : false;

    if (existingBarcode) {
      return err({
        code: codes.barcodeAlreadyExists,
        message: "This barcode is already in use. Choose another barcode.",
        details: [],
      });
    }

    const locations = await this.db
      .select({ id: tables.location.id })
      .from(tables.location)
      .where(eq(tables.location.merchantId, this.user.merchantId));

    const productId = generateId({ model: "product" });
    const variantId = generateId({ model: "variant" });
    const slugSuffix = productId.toLowerCase();
    const slugName = (slugify(request.name) || "product").slice(0, 128 - slugSuffix.length - 1);

    const productValues: typeof tables.product.$inferInsert = {
      id: productId,
      merchantId: this.user.merchantId,
      name: request.name,
      slug: `${slugName}-${slugSuffix}`,
      price: request.price,
      unitCost: request.unitCost,
      type: request.productType,
      status: "draft",
      collectionId: request.collectionId ?? null,
    };

    const variantValues: typeof tables.variant.$inferInsert = {
      id: variantId,
      merchantId: this.user.merchantId,
      productId,
      name: request.name,
      price: request.price,
      sku: request.sku ?? null,
      barcode: request.barcode ?? null,
    };

    const imageValues: typeof tables.productImage.$inferInsert | null = request.imageUrl
      ? {
          id: generateId({ model: "img" }),
          merchantId: this.user.merchantId,
          productId,
          source: "remote",
          remoteUrl: request.imageUrl,
          status: "available",
          activatedAt: now(),
        }
      : null;

    const inventoryValues = locations.map((location) => ({
      id: generateId({ model: "inventoryLevel" }),
      merchantId: this.user.merchantId,
      variantId,
      locationId: location.id,
      onHand: 0,
    }));

    return this.db.transaction(async (trx) => {
      await trx.insert(tables.product).values(productValues);

      await trx
        .insert(tables.variant)
        .values(variantValues)
        .onDuplicateKeyUpdate({
          set: {
            id: sql`${tables.variant.id}`,
            updatedAt: sql`${tables.variant.updatedAt}`,
          },
        });

      const [variant] = await trx.select().from(tables.variant).where(eq(tables.variant.id, variantId)).for("update");

      if (!variant) {
        await trx.delete(tables.product).where(eq(tables.product.id, productId));

        const [existingSku] = request.sku
          ? await trx
              .select({ id: tables.variant.id })
              .from(tables.variant)
              .where(and(eq(tables.variant.merchantId, this.user.merchantId), eq(tables.variant.sku, request.sku)))
              .for("update")
          : [];

        if (existingSku) {
          return err({
            code: codes.skuAlreadyExists,
            message: "This SKU is already in use. Choose another SKU.",
            details: [],
          });
        }

        return err({
          code: codes.barcodeAlreadyExists,
          message: "This barcode is already in use. Choose another barcode.",
          details: [],
        });
      }

      if (inventoryValues.length > 0) {
        await trx.insert(tables.inventoryLevel).values(inventoryValues);
      }

      if (imageValues) {
        await trx.insert(tables.productImage).values(imageValues);
      }

      const product = await assertFound(
        this.productFinder.find(trx, { merchantId: this.user.merchantId, id: productId }),
      );

      return ok(product);
    });
  }
}

export { CreateProductRequest, CreateProductService };
