import { and, asc, desc, eq, exists, gt, isNull } from "drizzle-orm";
import type { ScopedPaginationRequest } from "../contracts/pagination-query.ts";
import type { PaginationResponse } from "../contracts/pagination-response.ts";
import { Product } from "../contracts/product.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";
import { paginate } from "../utils/paginate.ts";
import { CollectionFinder } from "./collection-finder.ts";

type Criteria = {
  merchantId: string;
  id?: string;
  sku?: string;
  barcode?: string;
};

class ProductFinder {
  async find(db: Database, criteria: Criteria): Promise<Product | null> {
    const [record] = await db
      .select()
      .from(tables.product)
      .where(this.where(db, criteria))
      .orderBy(tables.product.id)
      .limit(1);
    if (!record) {
      return null;
    }

    const merchantId = criteria.merchantId;
    const collection = record.collectionId
      ? await new CollectionFinder().find(db, { merchantId, id: record.collectionId })
      : null;
    const variants = await db
      .select()
      .from(tables.variant)
      .where(and(eq(tables.variant.merchantId, merchantId), eq(tables.variant.productId, record.id)))
      .orderBy(tables.variant.id);
    const groups = await db
      .select({ group: tables.optionGroup })
      .from(tables.productOptionGroup)
      .innerJoin(
        tables.optionGroup,
        and(
          eq(tables.optionGroup.id, tables.productOptionGroup.optionGroupId),
          eq(tables.optionGroup.merchantId, merchantId),
        ),
      )
      .where(
        and(eq(tables.productOptionGroup.merchantId, merchantId), eq(tables.productOptionGroup.productId, record.id)),
      )
      .orderBy(tables.optionGroup.id);
    const optionGroups = await Promise.all(
      groups.map(async ({ group }) => {
        const options = await db
          .select()
          .from(tables.option)
          .where(and(eq(tables.option.merchantId, merchantId), eq(tables.option.optionGroupId, group.id)))
          .orderBy(asc(tables.option.position), asc(tables.option.id));
        return { ...group, options };
      }),
    );
    const loadedVariants = await Promise.all(
      variants.map(async (variant) => {
        const options = await db
          .select({ option: tables.option })
          .from(tables.variantOption)
          .innerJoin(
            tables.option,
            and(eq(tables.option.id, tables.variantOption.optionId), eq(tables.option.merchantId, merchantId)),
          )
          .where(and(eq(tables.variantOption.merchantId, merchantId), eq(tables.variantOption.variantId, variant.id)))
          .orderBy(asc(tables.option.position), asc(tables.option.id));
        const inventoryLevels = await db
          .select()
          .from(tables.inventoryLevel)
          .where(and(eq(tables.inventoryLevel.merchantId, merchantId), eq(tables.inventoryLevel.variantId, variant.id)))
          .orderBy(tables.inventoryLevel.id);
        return { ...variant, options: options.map(({ option }) => option), inventoryLevels };
      }),
    );
    const [image] = await db
      .select()
      .from(tables.productImage)
      .where(
        and(
          eq(tables.productImage.merchantId, merchantId),
          eq(tables.productImage.productId, record.id),
          eq(tables.productImage.status, "available"),
          isNull(tables.productImage.archivedAt),
        ),
      )
      .orderBy(desc(tables.productImage.activatedAt), desc(tables.productImage.id))
      .limit(1);

    return Product.parse({
      ...record,
      productType: record.type,
      collection,
      optionGroups,
      variants: loadedVariants,
      imageUrl: image?.remoteUrl ?? null,
    });
  }

  async paginate(db: Database, criteria: ScopedPaginationRequest): Promise<PaginationResponse<Product>> {
    const collection = await db
      .select({ id: tables.product.id })
      .from(tables.product)
      .where(
        and(
          eq(tables.product.merchantId, criteria.merchantId),
          criteria.cursor !== undefined ? gt(tables.product.id, criteria.cursor) : undefined,
        ),
      )
      .orderBy(tables.product.id)
      .limit(criteria.limit + 1);

    const page = paginate({ collection, limit: criteria.limit });

    const products = await Promise.all(
      page.results.map(({ id }) => this.find(db, { id, merchantId: criteria.merchantId })),
    );

    return {
      ...page,
      results: products.filter((product): product is Product => product !== null),
    };
  }

  async exists(db: Database, criteria: Criteria): Promise<boolean> {
    const [record] = await db
      .select({ id: tables.product.id })
      .from(tables.product)
      .where(this.where(db, criteria))
      .limit(1);
    return record !== undefined;
  }

  private where(db: Database, criteria: Criteria) {
    const variantMatch =
      criteria.sku !== undefined || criteria.barcode !== undefined
        ? exists(
            db
              .select({ id: tables.variant.id })
              .from(tables.variant)
              .where(
                and(
                  eq(tables.variant.merchantId, criteria.merchantId),
                  eq(tables.variant.productId, tables.product.id),
                  criteria.sku !== undefined ? eq(tables.variant.sku, criteria.sku) : undefined,
                  criteria.barcode !== undefined ? eq(tables.variant.barcode, criteria.barcode) : undefined,
                ),
              ),
          )
        : undefined;

    return and(
      eq(tables.product.merchantId, criteria.merchantId),
      criteria.id !== undefined ? eq(tables.product.id, criteria.id) : undefined,
      variantMatch,
    );
  }
}

export { ProductFinder };
