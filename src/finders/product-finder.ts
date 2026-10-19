import { and, asc, desc, eq, exists, gt, inArray, isNull, or } from "drizzle-orm";
import type { ScopedPaginationRequest } from "../contracts/pagination-query.ts";
import type { PaginationResponse } from "../contracts/pagination-response.ts";
import { Product } from "../contracts/product.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";
import { paginate } from "../utils/paginate.ts";
import { CollectionFinder } from "./collection-finder.ts";
import { type SyncCriteria, syncWindow } from "./sync-criteria.ts";

type Criteria = {
  merchantId: string;
  id?: string;
  sku?: string;
  barcode?: string;
};

function groupBy<TRecord>(records: Array<TRecord>, key: (record: TRecord) => string): Map<string, Array<TRecord>> {
  const groups = new Map<string, Array<TRecord>>();
  for (const record of records) {
    const groupKey = key(record);
    const group = groups.get(groupKey) ?? [];
    group.push(record);
    groups.set(groupKey, group);
  }
  return groups;
}

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

  async findForSync(db: Database, criteria: SyncCriteria): Promise<Array<Product>> {
    const merchantId = criteria.merchantId;
    const products = await db
      .select()
      .from(tables.product)
      .where(and(eq(tables.product.merchantId, merchantId), this.syncChanges(db, criteria)))
      .orderBy(tables.product.id);
    if (products.length === 0) {
      return [];
    }

    const productIds = products.map((product) => product.id);
    const collections = await db
      .select()
      .from(tables.collection)
      .where(
        and(
          eq(tables.collection.merchantId, merchantId),
          inArray(
            tables.collection.id,
            products.flatMap((product) => product.collectionId ?? []),
          ),
        ),
      );
    const variants = await db
      .select()
      .from(tables.variant)
      .where(and(eq(tables.variant.merchantId, merchantId), inArray(tables.variant.productId, productIds)))
      .orderBy(tables.variant.id);
    const variantIds = variants.map((variant) => variant.id);
    const inventoryLevels = await db
      .select()
      .from(tables.inventoryLevel)
      .where(
        and(eq(tables.inventoryLevel.merchantId, merchantId), inArray(tables.inventoryLevel.variantId, variantIds)),
      )
      .orderBy(tables.inventoryLevel.id);
    const productGroups = await db
      .select()
      .from(tables.productOptionGroup)
      .where(
        and(
          eq(tables.productOptionGroup.merchantId, merchantId),
          inArray(tables.productOptionGroup.productId, productIds),
        ),
      )
      .orderBy(tables.productOptionGroup.optionGroupId);
    const groupIds = productGroups.map((link) => link.optionGroupId);
    const optionGroups = await db
      .select()
      .from(tables.optionGroup)
      .where(and(eq(tables.optionGroup.merchantId, merchantId), inArray(tables.optionGroup.id, groupIds)))
      .orderBy(tables.optionGroup.id);
    const variantOptions = await db
      .select()
      .from(tables.variantOption)
      .where(and(eq(tables.variantOption.merchantId, merchantId), inArray(tables.variantOption.variantId, variantIds)));
    const options = await db
      .select()
      .from(tables.option)
      .where(
        and(
          eq(tables.option.merchantId, merchantId),
          or(
            inArray(tables.option.optionGroupId, groupIds),
            inArray(
              tables.option.id,
              variantOptions.map((link) => link.optionId),
            ),
          ),
        ),
      )
      .orderBy(asc(tables.option.position), asc(tables.option.id));
    const images = await db
      .select()
      .from(tables.productImage)
      .where(
        and(
          eq(tables.productImage.merchantId, merchantId),
          inArray(tables.productImage.productId, productIds),
          eq(tables.productImage.status, "available"),
          isNull(tables.productImage.archivedAt),
        ),
      )
      .orderBy(desc(tables.productImage.activatedAt), desc(tables.productImage.id));

    const collectionsById = new Map(collections.map((collection) => [collection.id, collection]));
    const optionsByGroup = groupBy(options, (option) => option.optionGroupId);
    const groupsById = new Map(
      optionGroups.map((group) => [group.id, { ...group, options: optionsByGroup.get(group.id) ?? [] }]),
    );
    const groupsByProduct = groupBy(productGroups, (group) => group.productId);
    const inventoryByVariant = groupBy(inventoryLevels, (level) => level.variantId);
    const optionIdsByVariant = groupBy(variantOptions, (option) => option.variantId);
    const optionsById = new Map(options.map((option) => [option.id, option]));
    const variantsByProduct = groupBy(
      variants.map((variant) => ({
        ...variant,
        options: (optionIdsByVariant.get(variant.id) ?? [])
          .flatMap((link) => optionsById.get(link.optionId) ?? [])
          .sort((first, second) => first.position - second.position || first.id.localeCompare(second.id)),
        inventoryLevels: inventoryByVariant.get(variant.id) ?? [],
      })),
      (variant) => variant.productId,
    );
    const imagesByProduct = groupBy(images, (image) => image.productId);

    return products.map((product) =>
      Product.parse({
        ...product,
        productType: product.type,
        collection: product.collectionId ? collectionsById.get(product.collectionId) : null,
        optionGroups: (groupsByProduct.get(product.id) ?? []).flatMap(
          (link) => groupsById.get(link.optionGroupId) ?? [],
        ),
        variants: variantsByProduct.get(product.id) ?? [],
        imageUrl: imagesByProduct.get(product.id)?.[0]?.remoteUrl ?? null,
      }),
    );
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

  private syncChanges(db: Database, criteria: SyncCriteria) {
    // Association-only updates must touch product.updatedAt because link tables have no timestamps.
    if (criteria.previousSyncedAt === null) {
      return undefined;
    }
    const merchantId = criteria.merchantId;
    return or(
      syncWindow(tables.product.updatedAt, criteria),
      exists(
        db
          .select({ id: tables.collection.id })
          .from(tables.collection)
          .where(
            and(
              eq(tables.collection.merchantId, merchantId),
              eq(tables.collection.id, tables.product.collectionId),
              syncWindow(tables.collection.updatedAt, criteria),
            ),
          ),
      ),
      exists(
        db
          .select({ id: tables.variant.id })
          .from(tables.variant)
          .where(
            and(
              eq(tables.variant.merchantId, merchantId),
              eq(tables.variant.productId, tables.product.id),
              syncWindow(tables.variant.updatedAt, criteria),
            ),
          ),
      ),
      exists(
        db
          .select({ id: tables.inventoryLevel.id })
          .from(tables.inventoryLevel)
          .innerJoin(
            tables.variant,
            and(eq(tables.variant.id, tables.inventoryLevel.variantId), eq(tables.variant.merchantId, merchantId)),
          )
          .where(
            and(
              eq(tables.inventoryLevel.merchantId, merchantId),
              eq(tables.variant.productId, tables.product.id),
              syncWindow(tables.inventoryLevel.updatedAt, criteria),
            ),
          ),
      ),
      exists(
        db
          .select({ id: tables.productImage.id })
          .from(tables.productImage)
          .where(
            and(
              eq(tables.productImage.merchantId, merchantId),
              eq(tables.productImage.productId, tables.product.id),
              syncWindow(tables.productImage.updatedAt, criteria),
            ),
          ),
      ),
      exists(
        db
          .select({ id: tables.productOptionGroup.id })
          .from(tables.productOptionGroup)
          .innerJoin(
            tables.optionGroup,
            and(
              eq(tables.optionGroup.id, tables.productOptionGroup.optionGroupId),
              eq(tables.optionGroup.merchantId, merchantId),
            ),
          )
          .leftJoin(
            tables.option,
            and(eq(tables.option.optionGroupId, tables.optionGroup.id), eq(tables.option.merchantId, merchantId)),
          )
          .where(
            and(
              eq(tables.productOptionGroup.merchantId, merchantId),
              eq(tables.productOptionGroup.productId, tables.product.id),
              or(syncWindow(tables.optionGroup.updatedAt, criteria), syncWindow(tables.option.updatedAt, criteria)),
            ),
          ),
      ),
      exists(
        db
          .select({ id: tables.variantOption.id })
          .from(tables.variantOption)
          .innerJoin(
            tables.variant,
            and(eq(tables.variant.id, tables.variantOption.variantId), eq(tables.variant.merchantId, merchantId)),
          )
          .innerJoin(
            tables.option,
            and(eq(tables.option.id, tables.variantOption.optionId), eq(tables.option.merchantId, merchantId)),
          )
          .where(
            and(
              eq(tables.variantOption.merchantId, merchantId),
              eq(tables.variant.productId, tables.product.id),
              syncWindow(tables.option.updatedAt, criteria),
            ),
          ),
      ),
    );
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
