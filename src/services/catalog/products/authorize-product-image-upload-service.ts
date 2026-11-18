import { and, eq, isNull } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../../contracts/business-error.ts";
import type { CurrentUser } from "../../../contracts/current-user.ts";
import type { Database } from "../../../db/index.ts";
import { tables } from "../../../db/schema.ts";
import type { ProductFinder } from "../../../finders/product-finder.ts";
import {
  MAX_PRODUCT_IMAGE_BYTE_SIZE,
  WEBP_SIGNATURE_LENGTH,
  productImageUploadKey,
  type ProductImageStore,
  type ProductImageUpload,
} from "../../../integrations/product-image-store.ts";
import { generateId } from "../../../utils/generate-id.ts";
import { now } from "../../../utils/now.ts";
import { err, ok, type Result } from "../../../utils/result.ts";
import { BaseService } from "../../base-service.ts";

const AuthorizeProductImageUploadRequest = z.object({
  byteSize: z.int().min(WEBP_SIGNATURE_LENGTH).max(MAX_PRODUCT_IMAGE_BYTE_SIZE),
});

type AuthorizeProductImageUploadRequest = z.infer<typeof AuthorizeProductImageUploadRequest>;
type Authorization = ProductImageUpload & { id: string };

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  productFinder: ProductFinder;
  productImageStore: Pick<ProductImageStore, "authorizeUpload">;
  user: CurrentUser;
};

class AuthorizeProductImageUploadService extends BaseService<
  [string, AuthorizeProductImageUploadRequest],
  Authorization
> {
  private readonly db: Database;
  private readonly productFinder: ProductFinder;
  private readonly productImageStore: Pick<ProductImageStore, "authorizeUpload">;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    productFinder: ProductFinder,
    productImageStore: Pick<ProductImageStore, "authorizeUpload">,
    user: CurrentUser,
  ) {
    super(logger);
    this.db = db;
    this.productFinder = productFinder;
    this.productImageStore = productImageStore;
    this.user = user;
  }

  static create({
    logger,
    db,
    productFinder,
    productImageStore,
    user,
  }: InjectedDependencies): AuthorizeProductImageUploadService {
    return new AuthorizeProductImageUploadService(logger, db, productFinder, productImageStore, user);
  }

  async execute([productId, { byteSize }]: [string, AuthorizeProductImageUploadRequest]): Promise<
    Result<Authorization, BusinessError>
  > {
    const { merchantId } = this.user;
    const notFound = err({
      code: codes.resourceNotFound,
      message: `Product ${productId} has not been found.`,
      details: [],
    });
    if (!(await this.productFinder.exists(this.db, { id: productId, merchantId }))) {
      return notFound;
    }

    const id = generateId({ model: "img" });
    const storageKey = productImageUploadKey(merchantId, productId, id);
    const authorization = await this.productImageStore.authorizeUpload(storageKey, byteSize);
    if (!authorization.success) {
      return authorization;
    }

    return this.db.transaction(async (trx) => {
      const [product] = await trx
        .select({ id: tables.product.id })
        .from(tables.product)
        .where(and(eq(tables.product.id, productId), eq(tables.product.merchantId, merchantId)))
        .for("update");
      if (!product) {
        return notFound;
      }

      await trx
        .update(tables.productImage)
        .set({ archivedAt: now() })
        .where(
          and(
            eq(tables.productImage.merchantId, merchantId),
            eq(tables.productImage.productId, productId),
            eq(tables.productImage.status, "pending"),
            isNull(tables.productImage.archivedAt),
          ),
        );
      await trx.insert(tables.productImage).values({
        id,
        productId,
        merchantId,
        source: "managed",
        storageKey,
        declaredByteSize: byteSize,
        status: "pending",
        uploadExpiresAt: authorization.value.expiresAt,
      });
      return ok({ id, ...authorization.value });
    });
  }
}

export { AuthorizeProductImageUploadRequest, AuthorizeProductImageUploadService };
