import { and, eq, isNull } from "drizzle-orm";
import type { Logger } from "pino";
import { codes, INTERNAL_SEVER_ERROR, type BusinessError } from "../../../contracts/business-error.ts";
import type { CurrentUser } from "../../../contracts/current-user.ts";
import type { Product } from "../../../contracts/product.ts";
import type { Database } from "../../../db/index.ts";
import { tables } from "../../../db/schema.ts";
import type { ProductFinder } from "../../../finders/product-finder.ts";
import type { ProductImageStore } from "../../../integrations/product-image-store.ts";
import type { RealtimeEventPublisher } from "../../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../../utils/assert-found.ts";
import { now } from "../../../utils/now.ts";
import { err, ok, type Result } from "../../../utils/result.ts";
import { BaseService } from "../../base-service.ts";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  productFinder: ProductFinder;
  productImageStore: Pick<ProductImageStore, "verifyUpload">;
  publisher: RealtimeEventPublisher;
  user: CurrentUser;
};

function uploadConflict(message: string) {
  return err({ code: codes.conflictError, message, details: [] });
}

function uploadUnavailable(image: typeof tables.productImage.$inferSelect) {
  if (image.archivedAt) {
    return uploadConflict("This image upload was replaced or removed. Request a new authorization.");
  }
  if (image.status === "pending" && now().getTime() - image.createdAt.getTime() >= VERIFICATION_TTL_MS) {
    return uploadConflict("This image upload has expired. Request a new authorization.");
  }
}

class VerifyProductImageUploadService extends BaseService<[string, string], Product> {
  private readonly db: Database;
  private readonly productFinder: ProductFinder;
  private readonly productImageStore: Pick<ProductImageStore, "verifyUpload">;
  private readonly publisher: RealtimeEventPublisher;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    productFinder: ProductFinder,
    productImageStore: Pick<ProductImageStore, "verifyUpload">,
    publisher: RealtimeEventPublisher,
    user: CurrentUser,
  ) {
    super(logger);
    this.db = db;
    this.productFinder = productFinder;
    this.productImageStore = productImageStore;
    this.publisher = publisher;
    this.user = user;
  }

  static create({
    logger,
    db,
    productFinder,
    productImageStore,
    publisher,
    user,
  }: InjectedDependencies): VerifyProductImageUploadService {
    return new VerifyProductImageUploadService(logger, db, productFinder, productImageStore, publisher, user);
  }

  async execute([productId, imageId]: [string, string]): Promise<Result<Product, BusinessError>> {
    const { merchantId } = this.user;
    const productFilter = and(eq(tables.product.id, productId), eq(tables.product.merchantId, merchantId));
    const imageFilter = and(
      eq(tables.productImage.id, imageId),
      eq(tables.productImage.productId, productId),
      eq(tables.productImage.merchantId, merchantId),
      eq(tables.productImage.source, "managed"),
    );
    const notFound = err({
      code: codes.resourceNotFound,
      message: `Image upload ${imageId} has not been found.`,
      details: [],
    });

    const upload = await this.db.transaction(
      async (trx) => {
        const [image] = await trx.select().from(tables.productImage).where(imageFilter);
        if (!image) {
          return notFound;
        }
        const unavailable = uploadUnavailable(image);
        if (unavailable) {
          return unavailable;
        }
        if (image.status === "available") {
          const product = await assertFound(this.productFinder.find(trx, { id: productId, merchantId }));
          return ok({ status: "available", product } as const);
        }
        return ok({ status: "pending", image } as const);
      },
      { isolationLevel: "repeatable read", withConsistentSnapshot: true },
    );
    if (!upload.success) {
      return upload;
    }
    if (upload.value.status === "available") {
      return ok(upload.value.product);
    }
    const { image } = upload.value;
    if (image.storageKey === null || image.declaredByteSize === null) {
      this.logger.error({ imageId, productId, merchantId }, "Pending image upload has no storage key or byte size");
      return err(INTERNAL_SEVER_ERROR);
    }

    const verified = await this.productImageStore.verifyUpload(image.storageKey, image.declaredByteSize);
    if (!verified.success) {
      return verified;
    }

    const result = await this.db.transaction(async (trx) => {
      const [product] = await trx
        .select({ updatedAt: tables.product.updatedAt })
        .from(tables.product)
        .where(productFilter)
        .for("update");
      if (!product) {
        return notFound;
      }

      const [pending] = await trx.select().from(tables.productImage).where(imageFilter).for("update");
      if (!pending) {
        return notFound;
      }
      const unavailable = uploadUnavailable(pending);
      if (unavailable) {
        return unavailable;
      }
      if (pending.status === "available") {
        return ok({
          activated: false,
          product: await assertFound(this.productFinder.find(trx, { id: productId, merchantId })),
        });
      }

      const activatedAt = new Date(Math.max(now().getTime(), product.updatedAt.getTime() + 1));
      await trx
        .update(tables.productImage)
        .set({ archivedAt: activatedAt, updatedAt: activatedAt })
        .where(
          and(
            eq(tables.productImage.productId, productId),
            eq(tables.productImage.merchantId, merchantId),
            eq(tables.productImage.status, "available"),
            isNull(tables.productImage.archivedAt),
          ),
        );
      await trx
        .update(tables.productImage)
        .set({
          storageKey: verified.value.storageKey,
          remoteUrl: verified.value.publicUrl,
          status: "available",
          activatedAt,
          updatedAt: activatedAt,
        })
        .where(imageFilter);
      await trx.update(tables.product).set({ updatedAt: activatedAt }).where(productFilter);

      return ok({
        activated: true,
        product: await assertFound(this.productFinder.find(trx, { id: productId, merchantId })),
      });
    });
    if (!result.success) {
      return result;
    }
    if (result.value.activated) {
      this.publisher.broadcast({ merchantId, resource: { type: "product", snapshot: result.value.product } });
    }
    return ok(result.value.product);
  }
}

export { VerifyProductImageUploadService };
