import {
  boolean,
  char,
  datetime,
  decimal,
  foreignKey,
  index,
  int,
  mysqlTable,
  unique,
  varchar,
} from "drizzle-orm/mysql-core";
import type { BusinessType } from "../contracts/business-type.ts";
import type { Employee } from "../contracts/employee.ts";
import type { InventoryMovementReason } from "../contracts/inventory-movement-reason.ts";
import type { InventoryState } from "../contracts/inventory-state.ts";
import { ID_LENGTH } from "../contracts/object-id.ts";
import type { PaymentMethod } from "../contracts/payment-method.ts";
import type { PurchaseStatus } from "../contracts/purchase-status.ts";
import type { ProductImageSource } from "../contracts/product-image-source.ts";
import type { ProductImageStatus } from "../contracts/product-image-status.ts";
import { PRODUCT_IMAGE_URL_MAX_LENGTH } from "../contracts/product-image.ts";
import type { ProductStatus } from "../contracts/product-status.ts";
import type { ProductType } from "../contracts/product-type.ts";
import type { SaleStatus } from "../contracts/sale-status.ts";
import type { Source } from "../contracts/source.ts";
import { now } from "../utils/now.ts";

const FLOAT_SCALE = 2 as const;
const FLOAT_PRECISION = 12 as const;

export const merchant = mysqlTable("merchants", {
  id: char({ length: ID_LENGTH }).primaryKey(),
  name: varchar({ length: 128 }).notNull(),
  country: char({ length: 2 }).notNull().default("ZZ"),
  createdAt: datetime({ mode: "date", fsp: 6 })
    .notNull()
    .$defaultFn(() => now()),
  updatedAt: datetime({ mode: "date", fsp: 6 })
    .notNull()
    .$defaultFn(() => now())
    .$onUpdateFn(() => now()),
});

export const account = mysqlTable(
  "accounts",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    email: varchar({ length: 320 }).notNull(),
    externalId: varchar({ length: 128 }).notNull(),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
  },
  (table) => [
    unique("accounts_external_id_unique").on(table.externalId),
    unique("accounts_merchant_id_email_unique").on(table.merchantId, table.email),
    unique("accounts_merchant_id_unique").on(table.merchantId, table.id),
  ],
);

export const employee = mysqlTable(
  "employees",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    name: varchar({ length: 128 }).notNull(),
    merchantId: char({ length: ID_LENGTH })
      .notNull()
      .references(() => merchant.id),
    isOwner: boolean().notNull().default(false),
    status: varchar({ length: 24 }).notNull().default("invited").$type<Employee["status"]>(),
    permissions: varchar({ length: 256 }),
    maxDiscountRate: decimal({ precision: 3, scale: 2, mode: "string", unsigned: true }).notNull().default("0.00"),
    accountId: char({ length: ID_LENGTH }).references(() => account.id),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
  },
  (table) => [
    unique("employees_account_id_unique").on(table.accountId),
    unique("employees_merchant_id_unique").on(table.merchantId, table.id),
    foreignKey({
      columns: [table.merchantId, table.accountId],
      foreignColumns: [account.merchantId, account.id],
      name: "employees_merchant_accountId_fk",
    }).onDelete("restrict"),
  ],
);

export const location = mysqlTable(
  "locations",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    name: varchar({ length: 128 }).notNull(),
    phone: varchar({ length: 32 }),
    address: varchar({ length: 256 }),
    taxId: char({ length: 32 }),
    businessType: varchar({ length: 24 }).$type<BusinessType>().notNull().default("other"),
    allowBackorders: boolean().notNull().default(false),
    exchangeRate: decimal({ precision: FLOAT_PRECISION, scale: FLOAT_SCALE, mode: "string", unsigned: true })
      .notNull()
      .default("0.00"),
    receiptHeaderText: varchar({ length: 256 }),
    receiptFooterText: varchar({ length: 256 }),
    taxRate: decimal({ precision: FLOAT_PRECISION, scale: FLOAT_SCALE, mode: "string", unsigned: true }).default(
      "0.00",
    ),
    nextSaleNumber: int({ unsigned: true }).notNull().default(1),
    nextPurchaseOrderNumber: int({ unsigned: true }).notNull().default(1),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),

    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
  },
  (table) => [
    index("locations_merchant_id_idx").on(table.merchantId),
    unique("locations_merchant_id_unique").on(table.merchantId, table.id),
  ],
);

export const locationAccess = mysqlTable(
  "location_access",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    locationId: char({ length: ID_LENGTH })
      .references(() => location.id)
      .notNull(),
    employeeId: char({ length: ID_LENGTH })
      .references(() => employee.id)
      .notNull(),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    unique("location_access_location_employee_unique").on(table.locationId, table.employeeId),
    index("location_access_employee_id_idx").on(table.employeeId),
    index("location_access_merchant_id_idx").on(table.merchantId),
    unique("location_access_merchant_id_unique").on(table.merchantId, table.id),
    foreignKey({
      columns: [table.merchantId, table.locationId],
      foreignColumns: [location.merchantId, location.id],
      name: "location_access_merchant_locationId_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.merchantId, table.employeeId],
      foreignColumns: [employee.merchantId, employee.id],
      name: "location_access_merchant_employeeId_fk",
    }).onDelete("restrict"),
  ],
);

export const collection = mysqlTable(
  "collections",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    name: varchar({ length: 128 }).notNull(),
    slug: varchar({ length: 128 }).notNull(),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
  },
  (table) => [
    unique("collections_merchant_id_slug_unique").on(table.merchantId, table.slug),
    unique("collections_merchant_id_unique").on(table.merchantId, table.id),
  ],
);

export const product = mysqlTable(
  "products",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    name: varchar({ length: 128 }).notNull(),
    slug: varchar({ length: 128 }).notNull(),
    price: decimal({ precision: FLOAT_PRECISION, scale: FLOAT_SCALE, mode: "string", unsigned: true }).notNull(),
    unitCost: decimal({ precision: FLOAT_PRECISION, scale: FLOAT_SCALE, mode: "string", unsigned: true }).notNull(),
    inventoryVersion: int({ unsigned: true }).notNull().default(0),
    lastRestockAt: datetime({ mode: "date", fsp: 6 }),
    status: varchar({ length: 24 }).$type<ProductStatus>().notNull().default("draft"),
    type: varchar({ length: 24 }).$type<ProductType>().notNull().default("item"),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
    archivedAt: datetime({ mode: "date", fsp: 6 }),
    collectionId: char({ length: ID_LENGTH }).references(() => collection.id),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    unique("products_merchant_id_slug_unique").on(table.merchantId, table.slug),
    unique("products_merchant_id_unique").on(table.merchantId, table.id),
    index("products_collection_id_idx").on(table.collectionId),
    foreignKey({
      columns: [table.merchantId, table.collectionId],
      foreignColumns: [collection.merchantId, collection.id],
      name: "products_merchant_collectionId_fk",
    }).onDelete("restrict"),
  ],
);

export const productImage = mysqlTable(
  "product_images",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    productId: char({ length: ID_LENGTH }).notNull(),
    source: varchar({ length: 16 }).$type<ProductImageSource>().notNull().default("managed"),
    storageKey: varchar({ length: 512 }),
    remoteUrl: varchar({ length: PRODUCT_IMAGE_URL_MAX_LENGTH }),
    declaredByteSize: int({ unsigned: true }),
    status: varchar({ length: 16 }).$type<ProductImageStatus>().notNull().default("pending"),
    uploadExpiresAt: datetime({ mode: "date", fsp: 6 }),
    activatedAt: datetime({ mode: "date", fsp: 6 }),
    merchantId: char({ length: ID_LENGTH })
      .notNull()
      .references(() => merchant.id, { onDelete: "cascade" }),
    archivedAt: datetime({ mode: "date", fsp: 6 }),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
  },
  (table) => [
    unique("product_images_storage_key_idx").on(table.storageKey),
    index("product_images_product_status_archived_activated_idx").on(
      table.productId,
      table.status,
      table.archivedAt,
      table.activatedAt,
      table.id,
    ),
    index("product_images_cleanup_idx").on(table.status, table.archivedAt, table.createdAt, table.id),
    foreignKey({
      columns: [table.merchantId, table.productId],
      foreignColumns: [product.merchantId, product.id],
      name: "product_images_merchant_product_fk",
    }).onDelete("cascade"),
    unique("product_images_merchant_id_unique").on(table.merchantId, table.id),
  ],
);

export const variant = mysqlTable(
  "variants",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    name: varchar({ length: 128 }).notNull(),
    barcode: varchar({ length: 128 }),
    sku: varchar({ length: 128 }),
    price: decimal({ precision: FLOAT_PRECISION, scale: FLOAT_SCALE, mode: "string", unsigned: true }).notNull(),
    combinationKey: varchar({ length: 256 }),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
    archivedAt: datetime({ mode: "date", fsp: 6 }),
    productId: char({ length: ID_LENGTH })
      .references(() => product.id)
      .notNull(),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    unique("variants_merchant_id_barcode_unique").on(table.merchantId, table.barcode),
    unique("variants_merchant_id_sku_unique").on(table.merchantId, table.sku),
    unique("variants_product_id_combination_key_unique").on(table.productId, table.combinationKey),
    unique("variants_merchant_id_unique").on(table.merchantId, table.id),
    foreignKey({
      columns: [table.merchantId, table.productId],
      foreignColumns: [product.merchantId, product.id],
      name: "variants_merchant_productId_fk",
    }).onDelete("restrict"),
  ],
);

export const optionGroup = mysqlTable(
  "option_groups",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    name: varchar({ length: 128 }).notNull(),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    index("option_groups_merchant_id_idx").on(table.merchantId),
    unique("option_groups_merchant_id_unique").on(table.merchantId, table.id),
  ],
);

export const option = mysqlTable(
  "options",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    name: varchar({ length: 128 }).notNull(),
    position: int({ unsigned: true }).notNull().default(0),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
    optionGroupId: char({ length: ID_LENGTH })
      .references(() => optionGroup.id)
      .notNull(),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    unique("options_option_group_id_name_unique").on(table.optionGroupId, table.name),
    index("options_merchant_id_idx").on(table.merchantId),
    unique("options_merchant_id_unique").on(table.merchantId, table.id),
    foreignKey({
      columns: [table.merchantId, table.optionGroupId],
      foreignColumns: [optionGroup.merchantId, optionGroup.id],
      name: "options_merchant_optionGroupId_fk",
    }).onDelete("restrict"),
  ],
);

export const productOptionGroup = mysqlTable(
  "product_option_groups",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    productId: char({ length: ID_LENGTH })
      .references(() => product.id)
      .notNull(),
    optionGroupId: char({ length: ID_LENGTH })
      .references(() => optionGroup.id)
      .notNull(),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    unique("product_option_groups_product_group_unique").on(table.productId, table.optionGroupId),
    index("product_option_groups_option_group_id_idx").on(table.optionGroupId),
    index("product_option_groups_merchant_id_idx").on(table.merchantId),
    unique("product_option_groups_merchant_id_unique").on(table.merchantId, table.id),
    foreignKey({
      columns: [table.merchantId, table.productId],
      foreignColumns: [product.merchantId, product.id],
      name: "product_option_groups_merchant_productId_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.merchantId, table.optionGroupId],
      foreignColumns: [optionGroup.merchantId, optionGroup.id],
      name: "product_option_groups_merchant_optionGroupId_fk",
    }).onDelete("restrict"),
  ],
);

export const variantOption = mysqlTable(
  "variant_options",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    variantId: char({ length: ID_LENGTH })
      .references(() => variant.id)
      .notNull(),
    optionId: char({ length: ID_LENGTH })
      .references(() => option.id)
      .notNull(),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    unique("variant_options_variant_option_unique").on(table.variantId, table.optionId),
    index("variant_options_option_id_idx").on(table.optionId),
    index("variant_options_merchant_id_idx").on(table.merchantId),
    unique("variant_options_merchant_id_unique").on(table.merchantId, table.id),
    foreignKey({
      columns: [table.merchantId, table.variantId],
      foreignColumns: [variant.merchantId, variant.id],
      name: "variant_options_merchant_variantId_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.merchantId, table.optionId],
      foreignColumns: [option.merchantId, option.id],
      name: "variant_options_merchant_optionId_fk",
    }).onDelete("restrict"),
  ],
);

export const inventoryLevel = mysqlTable(
  "inventory_levels",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    onHand: int({ unsigned: true }).notNull().default(0),
    lowStockThreshold: int({ unsigned: true }).notNull().default(0),
    optimalStockLevel: int({ unsigned: true }).notNull().default(0),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
    locationId: char({ length: ID_LENGTH })
      .references(() => location.id)
      .notNull(),
    variantId: char({ length: ID_LENGTH })
      .references(() => variant.id)
      .notNull(),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    unique("inventory_levels_location_variant_unique").on(table.locationId, table.variantId),
    index("inventory_levels_variant_id_idx").on(table.variantId),
    index("inventory_levels_merchant_id_idx").on(table.merchantId),
    unique("inventory_levels_merchant_id_unique").on(table.merchantId, table.id),
    foreignKey({
      columns: [table.merchantId, table.locationId],
      foreignColumns: [location.merchantId, location.id],
      name: "inventory_levels_merchant_locationId_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.merchantId, table.variantId],
      foreignColumns: [variant.merchantId, variant.id],
      name: "inventory_levels_merchant_variantId_fk",
    }).onDelete("restrict"),
  ],
);

export const inventoryMovement = mysqlTable(
  "inventory_movements",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    reason: varchar({ length: 24 }).$type<InventoryMovementReason>().notNull(),
    fromState: varchar({ length: 24 }).$type<InventoryState>().notNull(),
    toState: varchar({ length: 24 }).$type<InventoryState>().notNull(),
    quantityDelta: int().notNull(),
    unitCost: decimal({ precision: FLOAT_PRECISION, scale: FLOAT_SCALE, mode: "string", unsigned: true }).notNull(),
    referenceId: char({ length: ID_LENGTH }),
    occurredAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    createdById: char({ length: ID_LENGTH })
      .references(() => employee.id)
      .notNull(),
    inventoryLevelId: char({ length: ID_LENGTH })
      .references(() => inventoryLevel.id)
      .notNull(),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    index("inventory_movements_level_occurred_at_idx").on(table.inventoryLevelId, table.occurredAt),
    index("inventory_movements_created_by_id_idx").on(table.createdById),
    index("inventory_movements_merchant_id_idx").on(table.merchantId),
    index("inventory_movements_reference_id_idx").on(table.referenceId),
    unique("inventory_movements_merchant_id_unique").on(table.merchantId, table.id),
    foreignKey({
      columns: [table.merchantId, table.createdById],
      foreignColumns: [employee.merchantId, employee.id],
      name: "inventory_movements_merchant_createdById_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.merchantId, table.inventoryLevelId],
      foreignColumns: [inventoryLevel.merchantId, inventoryLevel.id],
      name: "inventory_movements_merchant_inventoryLevelId_fk",
    }).onDelete("restrict"),
  ],
);

export const inventoryPhysicalCount = mysqlTable(
  "inventory_physical_counts",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    quantity: int({ unsigned: true }).notNull(),
    occurredAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    createdById: char({ length: ID_LENGTH })
      .references(() => employee.id)
      .notNull(),
    inventoryLevelId: char({ length: ID_LENGTH }).notNull(),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    index("inventory_physical_counts_level_occurred_at_idx").on(table.inventoryLevelId, table.occurredAt),
    index("inventory_physical_counts_created_by_id_idx").on(table.createdById),
    index("inventory_physical_counts_merchant_id_idx").on(table.merchantId),
    unique("inventory_physical_counts_merchant_id_unique").on(table.merchantId, table.id),
    foreignKey({
      columns: [table.merchantId, table.createdById],
      foreignColumns: [employee.merchantId, employee.id],
      name: "inventory_physical_counts_merchant_createdById_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.inventoryLevelId],
      foreignColumns: [inventoryLevel.id],
      name: "inventory_physical_counts_level_id_fk",
    }),
    foreignKey({
      columns: [table.merchantId, table.inventoryLevelId],
      foreignColumns: [inventoryLevel.merchantId, inventoryLevel.id],
      name: "inventory_physical_counts_merchant_inventoryLevelId_fk",
    }).onDelete("restrict"),
  ],
);

export const customer = mysqlTable(
  "customers",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    name: varchar({ length: 128 }).notNull(),
    email: varchar({ length: 320 }),
    phone: varchar({ length: 32 }),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    index("customers_merchant_id_idx").on(table.merchantId),
    unique("customers_merchant_id_unique").on(table.merchantId, table.id),
  ],
);

export const sale = mysqlTable(
  "sales",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    status: varchar({ length: 24 }).$type<SaleStatus>().notNull(),
    transactionNumber: int({ unsigned: true }).notNull(),
    source: varchar({ length: 24 }).$type<Source>().notNull(),
    businessDate: datetime({ mode: "date", fsp: 3 }).notNull(),
    discountRate: decimal({ precision: FLOAT_PRECISION, scale: FLOAT_SCALE, mode: "string", unsigned: true }),
    notes: varchar({ length: 256 }),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
    customerId: char({ length: ID_LENGTH }).references(() => customer.id),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
    locationId: char({ length: ID_LENGTH })
      .references(() => location.id)
      .notNull(),
    createdById: char({ length: ID_LENGTH })
      .notNull()
      .references(() => employee.id),
    voidedById: char({ length: ID_LENGTH }).references(() => employee.id),
    voidedAt: datetime({ mode: "date", fsp: 6 }),
    voidReason: varchar({ length: 256 }),
  },
  (table) => [
    unique("sales_location_id_transaction_number_unique").on(table.locationId, table.transactionNumber),
    index("sales_customer_id_idx").on(table.customerId),
    index("sales_merchant_id_idx").on(table.merchantId),
    index("sales_created_by_id_idx").on(table.createdById),
    index("sales_voided_by_id_idx").on(table.voidedById),
    unique("sales_merchant_id_unique").on(table.merchantId, table.id),
    foreignKey({
      columns: [table.merchantId, table.customerId],
      foreignColumns: [customer.merchantId, customer.id],
      name: "sales_merchant_customerId_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.merchantId, table.locationId],
      foreignColumns: [location.merchantId, location.id],
      name: "sales_merchant_locationId_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.merchantId, table.createdById],
      foreignColumns: [employee.merchantId, employee.id],
      name: "sales_merchant_createdById_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.merchantId, table.voidedById],
      foreignColumns: [employee.merchantId, employee.id],
      name: "sales_merchant_voidedById_fk",
    }).onDelete("restrict"),
  ],
);

export const salePayment = mysqlTable(
  "sale_payments",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    exchangeRate: decimal({ precision: FLOAT_PRECISION, scale: FLOAT_SCALE, mode: "string", unsigned: true }),
    amount: decimal({ precision: FLOAT_PRECISION, scale: FLOAT_SCALE, mode: "string", unsigned: true }).notNull(),
    method: varchar({ length: 24 }).$type<PaymentMethod>().notNull(),
    saleId: char({ length: ID_LENGTH })
      .references(() => sale.id)
      .notNull(),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    index("sale_payments_sale_id_idx").on(table.saleId),
    index("sale_payments_merchant_id_idx").on(table.merchantId),
    unique("sale_payments_merchant_id_unique").on(table.merchantId, table.id),
    foreignKey({
      columns: [table.merchantId, table.saleId],
      foreignColumns: [sale.merchantId, sale.id],
      name: "sale_payments_merchant_saleId_fk",
    }).onDelete("restrict"),
  ],
);

export const saleItem = mysqlTable(
  "sale_items",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    name: varchar({ length: 128 }).notNull(),
    quantity: int({ unsigned: true }).notNull(),
    price: decimal({ precision: FLOAT_PRECISION, scale: FLOAT_SCALE, mode: "string", unsigned: true }).notNull(),
    unitCost: decimal({ precision: FLOAT_PRECISION, scale: FLOAT_SCALE, mode: "string", unsigned: true }).notNull(),
    shortageQuantity: int({ unsigned: true }).notNull().default(0),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
    saleId: char({ length: ID_LENGTH })
      .references(() => sale.id)
      .notNull(),
    variantId: char({ length: ID_LENGTH })
      .references(() => variant.id)
      .notNull(),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    index("sale_items_sale_id_idx").on(table.saleId),
    index("sale_items_variant_id_idx").on(table.variantId),
    index("sale_items_merchant_id_idx").on(table.merchantId),
    unique("sale_items_merchant_id_unique").on(table.merchantId, table.id),
    foreignKey({
      columns: [table.merchantId, table.saleId],
      foreignColumns: [sale.merchantId, sale.id],
      name: "sale_items_merchant_saleId_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.merchantId, table.variantId],
      foreignColumns: [variant.merchantId, variant.id],
      name: "sale_items_merchant_variantId_fk",
    }).onDelete("restrict"),
  ],
);

export const supplier = mysqlTable(
  "suppliers",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    name: varchar({ length: 128 }).notNull(),
    email: varchar({ length: 320 }),
    phone: varchar({ length: 32 }),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    index("suppliers_merchant_id_idx").on(table.merchantId),
    unique("suppliers_merchant_id_unique").on(table.merchantId, table.id),
  ],
);

export const purchaseOrder = mysqlTable(
  "purchase_orders",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    status: varchar({ length: 24 }).$type<PurchaseStatus>().notNull(),
    transactionNumber: int({ unsigned: true }).notNull(),
    notes: varchar({ length: 256 }),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
    supplierId: char({ length: ID_LENGTH })
      .references(() => supplier.id)
      .notNull(),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
    locationId: char({ length: ID_LENGTH })
      .references(() => location.id)
      .notNull(),
    createdById: char({ length: ID_LENGTH })
      .notNull()
      .references(() => employee.id),
  },
  (table) => [
    unique("purchase_orders_location_transaction_unique").on(table.locationId, table.transactionNumber),
    index("purchase_orders_supplier_id_idx").on(table.supplierId),
    index("purchase_orders_merchant_id_idx").on(table.merchantId),
    index("purchase_orders_created_by_id_idx").on(table.createdById),
    unique("purchase_orders_merchant_id_unique").on(table.merchantId, table.id),
    foreignKey({
      columns: [table.merchantId, table.supplierId],
      foreignColumns: [supplier.merchantId, supplier.id],
      name: "purchase_orders_merchant_supplierId_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.merchantId, table.locationId],
      foreignColumns: [location.merchantId, location.id],
      name: "purchase_orders_merchant_locationId_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.merchantId, table.createdById],
      foreignColumns: [employee.merchantId, employee.id],
      name: "purchase_orders_merchant_createdById_fk",
    }).onDelete("restrict"),
  ],
);

export const purchaseOrderItem = mysqlTable(
  "purchase_order_items",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    name: varchar({ length: 128 }).notNull(),
    quantity: int({ unsigned: true }).notNull(),
    price: decimal({ precision: FLOAT_PRECISION, scale: FLOAT_SCALE, mode: "string", unsigned: true }).notNull(),
    unitCost: decimal({ precision: FLOAT_PRECISION, scale: FLOAT_SCALE, mode: "string", unsigned: true }).notNull(),
    createdAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now()),
    updatedAt: datetime({ mode: "date", fsp: 6 })
      .notNull()
      .$defaultFn(() => now())
      .$onUpdateFn(() => now()),
    purchaseOrderId: char({ length: ID_LENGTH })
      .references(() => purchaseOrder.id)
      .notNull(),
    variantId: char({ length: ID_LENGTH })
      .references(() => variant.id)
      .notNull(),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    index("purchase_order_items_order_id_idx").on(table.purchaseOrderId),
    index("purchase_order_items_variant_id_idx").on(table.variantId),
    index("purchase_order_items_merchant_id_idx").on(table.merchantId),
    unique("purchase_order_items_merchant_id_unique").on(table.merchantId, table.id),
    foreignKey({
      columns: [table.merchantId, table.purchaseOrderId],
      foreignColumns: [purchaseOrder.merchantId, purchaseOrder.id],
      name: "purchase_order_items_merchant_purchaseOrderId_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.merchantId, table.variantId],
      foreignColumns: [variant.merchantId, variant.id],
      name: "purchase_order_items_merchant_variantId_fk",
    }).onDelete("restrict"),
  ],
);

export const supplierProduct = mysqlTable(
  "supplier_products",
  {
    id: char({ length: ID_LENGTH }).primaryKey(),
    supplierId: char({ length: ID_LENGTH })
      .references(() => supplier.id)
      .notNull(),
    productId: char({ length: ID_LENGTH })
      .references(() => product.id)
      .notNull(),
    merchantId: char({ length: ID_LENGTH })
      .references(() => merchant.id)
      .notNull(),
  },
  (table) => [
    unique("supplier_products_supplier_product_unique").on(table.supplierId, table.productId),
    index("supplier_products_product_id_idx").on(table.productId),
    index("supplier_products_merchant_id_idx").on(table.merchantId),
    unique("supplier_products_merchant_id_unique").on(table.merchantId, table.id),
    foreignKey({
      columns: [table.merchantId, table.supplierId],
      foreignColumns: [supplier.merchantId, supplier.id],
      name: "supplier_products_merchant_supplierId_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.merchantId, table.productId],
      foreignColumns: [product.merchantId, product.id],
      name: "supplier_products_merchant_productId_fk",
    }).onDelete("restrict"),
  ],
);

const tables = Object.freeze({
  merchant,
  account,
  employee,
  location,
  locationAccess,
  customer,
  collection,
  product,
  productImage,
  variant,
  optionGroup,
  option,
  productOptionGroup,
  variantOption,
  inventoryLevel,
  inventoryMovement,
  inventoryPhysicalCount,
  sale,
  salePayment,
  saleItem,
  supplier,
  purchaseOrder,
  purchaseOrderItem,
  supplierProduct,
});

export { tables };
