START TRANSACTION;--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` char(24) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(32),
	`phoneVerified` boolean NOT NULL DEFAULT false,
	`externalId` varchar(128) NOT NULL,
	`merchantId` char(24) NOT NULL,
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `accounts_external_id_unique` UNIQUE(`externalId`),
	CONSTRAINT `accounts_phone_unique` UNIQUE(`phone`),
	CONSTRAINT `accounts_merchant_id_email_unique` UNIQUE(`merchantId`,`email`),
	CONSTRAINT `accounts_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` char(24) NOT NULL,
	`name` varchar(128) NOT NULL,
	`slug` varchar(128) NOT NULL,
	`merchantId` char(24) NOT NULL,
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	CONSTRAINT `collections_id` PRIMARY KEY(`id`),
	CONSTRAINT `collections_merchant_id_slug_unique` UNIQUE(`merchantId`,`slug`),
	CONSTRAINT `collections_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` char(24) NOT NULL,
	`name` varchar(128) NOT NULL,
	`email` varchar(320),
	`phone` varchar(32),
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `customers_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` char(24) NOT NULL,
	`name` varchar(128) NOT NULL,
	`merchantId` char(24) NOT NULL,
	`isOwner` boolean NOT NULL DEFAULT false,
	`status` varchar(24) NOT NULL DEFAULT 'invited',
	`permissions` varchar(256),
	`maxDiscountRate` decimal(3,2) unsigned NOT NULL DEFAULT '0.00',
	`accountId` char(24),
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	CONSTRAINT `employees_id` PRIMARY KEY(`id`),
	CONSTRAINT `employees_account_id_unique` UNIQUE(`accountId`),
	CONSTRAINT `employees_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_levels` (
	`id` char(24) NOT NULL,
	`onHand` int unsigned NOT NULL DEFAULT 0,
	`lowStockThreshold` int unsigned NOT NULL DEFAULT 0,
	`optimalStockLevel` int unsigned NOT NULL DEFAULT 0,
	`lastSoldAt` datetime(6),
	`lastRestockAt` datetime(6),
	`lastInventoryAdjustmentAt` datetime(6),
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	`locationId` char(24) NOT NULL,
	`variantId` char(24) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `inventory_levels_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_levels_location_variant_unique` UNIQUE(`locationId`,`variantId`),
	CONSTRAINT `inventory_levels_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` char(24) NOT NULL,
	`reason` varchar(24) NOT NULL,
	`fromState` varchar(24) NOT NULL,
	`toState` varchar(24) NOT NULL,
	`quantityDelta` int NOT NULL,
	`unitCost` decimal(12,2) unsigned NOT NULL,
	`referenceId` char(24),
	`occurredAt` datetime(6) NOT NULL,
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	`createdById` char(24) NOT NULL,
	`inventoryLevelId` char(24) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `inventory_movements_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_movements_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_physical_counts` (
	`id` char(24) NOT NULL,
	`quantity` int unsigned NOT NULL,
	`occurredAt` datetime(6) NOT NULL,
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	`createdById` char(24) NOT NULL,
	`inventoryLevelId` char(24) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `inventory_physical_counts_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_physical_counts_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` char(24) NOT NULL,
	`name` varchar(128) NOT NULL,
	`phone` varchar(32),
	`address` varchar(256),
	`taxId` char(32),
	`businessType` varchar(24) NOT NULL DEFAULT 'other',
	`allowBackorders` boolean NOT NULL DEFAULT false,
	`exchangeRate` decimal(12,2) unsigned NOT NULL DEFAULT '0.00',
	`receiptHeaderText` varchar(256),
	`receiptFooterText` varchar(256),
	`taxRate` decimal(12,2) unsigned DEFAULT '0.00',
	`nextSaleNumber` int unsigned NOT NULL DEFAULT 1,
	`nextPurchaseOrderNumber` int unsigned NOT NULL DEFAULT 1,
	`merchantId` char(24) NOT NULL,
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	CONSTRAINT `locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `locations_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `location_access` (
	`id` char(24) NOT NULL,
	`locationId` char(24) NOT NULL,
	`employeeId` char(24) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `location_access_id` PRIMARY KEY(`id`),
	CONSTRAINT `location_access_location_employee_unique` UNIQUE(`locationId`,`employeeId`),
	CONSTRAINT `location_access_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` char(24) NOT NULL,
	`name` varchar(128) NOT NULL,
	`country` char(2) NOT NULL DEFAULT 'ZZ',
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	CONSTRAINT `merchants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `options` (
	`id` char(24) NOT NULL,
	`name` varchar(128) NOT NULL,
	`position` int unsigned NOT NULL DEFAULT 0,
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	`optionGroupId` char(24) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `options_id` PRIMARY KEY(`id`),
	CONSTRAINT `options_option_group_id_name_unique` UNIQUE(`optionGroupId`,`name`),
	CONSTRAINT `options_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `option_groups` (
	`id` char(24) NOT NULL,
	`name` varchar(128) NOT NULL,
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `option_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `option_groups_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` char(24) NOT NULL,
	`name` varchar(128) NOT NULL,
	`slug` varchar(128) NOT NULL,
	`price` decimal(12,2) unsigned NOT NULL,
	`unitCost` decimal(12,2) unsigned NOT NULL,
	`lastRestockAt` datetime(6),
	`lastSoldAt` datetime(6),
	`status` varchar(24) NOT NULL DEFAULT 'draft',
	`type` varchar(24) NOT NULL DEFAULT 'item',
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	`archivedAt` datetime(6),
	`collectionId` char(24),
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_merchant_id_slug_unique` UNIQUE(`merchantId`,`slug`),
	CONSTRAINT `products_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` char(24) NOT NULL,
	`productId` char(24) NOT NULL,
	`source` varchar(16) NOT NULL DEFAULT 'managed',
	`storageKey` varchar(512),
	`remoteUrl` varchar(2048),
	`declaredByteSize` int unsigned,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`uploadExpiresAt` datetime(6),
	`activatedAt` datetime(6),
	`merchantId` char(24) NOT NULL,
	`archivedAt` datetime(6),
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	CONSTRAINT `product_images_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_images_storage_key_idx` UNIQUE(`storageKey`),
	CONSTRAINT `product_images_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `product_option_groups` (
	`id` char(24) NOT NULL,
	`productId` char(24) NOT NULL,
	`optionGroupId` char(24) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `product_option_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_option_groups_product_group_unique` UNIQUE(`productId`,`optionGroupId`),
	CONSTRAINT `product_option_groups_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` char(24) NOT NULL,
	`status` varchar(24) NOT NULL,
	`transactionNumber` int unsigned NOT NULL,
	`notes` varchar(256),
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	`supplierId` char(24) NOT NULL,
	`merchantId` char(24) NOT NULL,
	`locationId` char(24) NOT NULL,
	`createdById` char(24) NOT NULL,
	`voidedById` char(24),
	`voidedAt` datetime(6),
	`voidReason` varchar(256),
	CONSTRAINT `purchase_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `purchase_orders_location_transaction_unique` UNIQUE(`locationId`,`transactionNumber`),
	CONSTRAINT `purchase_orders_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_order_items` (
	`id` char(24) NOT NULL,
	`name` varchar(128) NOT NULL,
	`quantity` int unsigned NOT NULL,
	`price` decimal(12,2) unsigned NOT NULL,
	`unitCost` decimal(12,2) unsigned NOT NULL,
	`previousUnitCost` decimal(12,2) unsigned,
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	`purchaseOrderId` char(24) NOT NULL,
	`variantId` char(24) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `purchase_order_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `purchase_order_items_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `sales` (
	`id` char(24) NOT NULL,
	`status` varchar(24) NOT NULL,
	`transactionNumber` int unsigned NOT NULL,
	`source` varchar(24) NOT NULL,
	`businessDate` datetime(3) NOT NULL,
	`discountRate` decimal(12,2) unsigned,
	`notes` varchar(256),
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	`customerId` char(24),
	`merchantId` char(24) NOT NULL,
	`locationId` char(24) NOT NULL,
	`createdById` char(24) NOT NULL,
	`voidedById` char(24),
	`voidedAt` datetime(6),
	`voidReason` varchar(256),
	CONSTRAINT `sales_id` PRIMARY KEY(`id`),
	CONSTRAINT `sales_location_id_transaction_number_unique` UNIQUE(`locationId`,`transactionNumber`),
	CONSTRAINT `sales_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` char(24) NOT NULL,
	`name` varchar(128) NOT NULL,
	`quantity` int unsigned NOT NULL,
	`price` decimal(12,2) unsigned NOT NULL,
	`unitCost` decimal(12,2) unsigned NOT NULL,
	`shortageQuantity` int unsigned NOT NULL DEFAULT 0,
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	`saleId` char(24) NOT NULL,
	`variantId` char(24) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `sale_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `sale_items_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `sale_payments` (
	`id` char(24) NOT NULL,
	`exchangeRate` decimal(12,2) unsigned,
	`amount` decimal(12,2) unsigned NOT NULL,
	`method` varchar(24) NOT NULL,
	`saleId` char(24) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `sale_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `sale_payments_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` char(24) NOT NULL,
	`name` varchar(128) NOT NULL,
	`email` varchar(320),
	`phone` varchar(32),
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `suppliers_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `supplier_products` (
	`id` char(24) NOT NULL,
	`supplierId` char(24) NOT NULL,
	`productId` char(24) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `supplier_products_id` PRIMARY KEY(`id`),
	CONSTRAINT `supplier_products_supplier_product_unique` UNIQUE(`supplierId`,`productId`),
	CONSTRAINT `supplier_products_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `variants` (
	`id` char(24) NOT NULL,
	`name` varchar(128) NOT NULL,
	`barcode` varchar(128),
	`sku` varchar(128),
	`price` decimal(12,2) unsigned NOT NULL,
	`combinationKey` varchar(256),
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	`archivedAt` datetime(6),
	`productId` char(24) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `variants_id` PRIMARY KEY(`id`),
	CONSTRAINT `variants_merchant_id_barcode_unique` UNIQUE(`merchantId`,`barcode`),
	CONSTRAINT `variants_merchant_id_sku_unique` UNIQUE(`merchantId`,`sku`),
	CONSTRAINT `variants_product_id_combination_key_unique` UNIQUE(`productId`,`combinationKey`),
	CONSTRAINT `variants_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `variant_options` (
	`id` char(24) NOT NULL,
	`variantId` char(24) NOT NULL,
	`optionId` char(24) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `variant_options_id` PRIMARY KEY(`id`),
	CONSTRAINT `variant_options_variant_option_unique` UNIQUE(`variantId`,`optionId`),
	CONSTRAINT `variant_options_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `collections` ADD CONSTRAINT `collections_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customers` ADD CONSTRAINT `customers_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employees` ADD CONSTRAINT `employees_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employees` ADD CONSTRAINT `employees_accountId_accounts_id_fk` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employees` ADD CONSTRAINT `employees_merchant_accountId_fk` FOREIGN KEY (`merchantId`,`accountId`) REFERENCES `accounts`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_levels` ADD CONSTRAINT `inventory_levels_locationId_locations_id_fk` FOREIGN KEY (`locationId`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_levels` ADD CONSTRAINT `inventory_levels_variantId_variants_id_fk` FOREIGN KEY (`variantId`) REFERENCES `variants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_levels` ADD CONSTRAINT `inventory_levels_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_levels` ADD CONSTRAINT `inventory_levels_merchant_locationId_fk` FOREIGN KEY (`merchantId`,`locationId`) REFERENCES `locations`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_levels` ADD CONSTRAINT `inventory_levels_merchant_variantId_fk` FOREIGN KEY (`merchantId`,`variantId`) REFERENCES `variants`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_createdById_employees_id_fk` FOREIGN KEY (`createdById`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_inventoryLevelId_inventory_levels_id_fk` FOREIGN KEY (`inventoryLevelId`) REFERENCES `inventory_levels`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_merchant_createdById_fk` FOREIGN KEY (`merchantId`,`createdById`) REFERENCES `employees`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_merchant_inventoryLevelId_fk` FOREIGN KEY (`merchantId`,`inventoryLevelId`) REFERENCES `inventory_levels`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_physical_counts` ADD CONSTRAINT `inventory_physical_counts_createdById_employees_id_fk` FOREIGN KEY (`createdById`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_physical_counts` ADD CONSTRAINT `inventory_physical_counts_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_physical_counts` ADD CONSTRAINT `inventory_physical_counts_merchant_createdById_fk` FOREIGN KEY (`merchantId`,`createdById`) REFERENCES `employees`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_physical_counts` ADD CONSTRAINT `inventory_physical_counts_level_id_fk` FOREIGN KEY (`inventoryLevelId`) REFERENCES `inventory_levels`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_physical_counts` ADD CONSTRAINT `inventory_physical_counts_merchant_inventoryLevelId_fk` FOREIGN KEY (`merchantId`,`inventoryLevelId`) REFERENCES `inventory_levels`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `locations` ADD CONSTRAINT `locations_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `location_access` ADD CONSTRAINT `location_access_locationId_locations_id_fk` FOREIGN KEY (`locationId`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `location_access` ADD CONSTRAINT `location_access_employeeId_employees_id_fk` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `location_access` ADD CONSTRAINT `location_access_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `location_access` ADD CONSTRAINT `location_access_merchant_locationId_fk` FOREIGN KEY (`merchantId`,`locationId`) REFERENCES `locations`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `location_access` ADD CONSTRAINT `location_access_merchant_employeeId_fk` FOREIGN KEY (`merchantId`,`employeeId`) REFERENCES `employees`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `options` ADD CONSTRAINT `options_optionGroupId_option_groups_id_fk` FOREIGN KEY (`optionGroupId`) REFERENCES `option_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `options` ADD CONSTRAINT `options_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `options` ADD CONSTRAINT `options_merchant_optionGroupId_fk` FOREIGN KEY (`merchantId`,`optionGroupId`) REFERENCES `option_groups`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `option_groups` ADD CONSTRAINT `option_groups_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_collectionId_collections_id_fk` FOREIGN KEY (`collectionId`) REFERENCES `collections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_merchant_collectionId_fk` FOREIGN KEY (`merchantId`,`collectionId`) REFERENCES `collections`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_merchant_product_fk` FOREIGN KEY (`merchantId`,`productId`) REFERENCES `products`(`merchantId`,`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_option_groups` ADD CONSTRAINT `product_option_groups_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_option_groups` ADD CONSTRAINT `product_option_groups_optionGroupId_option_groups_id_fk` FOREIGN KEY (`optionGroupId`) REFERENCES `option_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_option_groups` ADD CONSTRAINT `product_option_groups_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_option_groups` ADD CONSTRAINT `product_option_groups_merchant_productId_fk` FOREIGN KEY (`merchantId`,`productId`) REFERENCES `products`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_option_groups` ADD CONSTRAINT `product_option_groups_merchant_optionGroupId_fk` FOREIGN KEY (`merchantId`,`optionGroupId`) REFERENCES `option_groups`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_supplierId_suppliers_id_fk` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_locationId_locations_id_fk` FOREIGN KEY (`locationId`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_createdById_employees_id_fk` FOREIGN KEY (`createdById`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_voidedById_employees_id_fk` FOREIGN KEY (`voidedById`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_merchant_supplierId_fk` FOREIGN KEY (`merchantId`,`supplierId`) REFERENCES `suppliers`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_merchant_locationId_fk` FOREIGN KEY (`merchantId`,`locationId`) REFERENCES `locations`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_merchant_createdById_fk` FOREIGN KEY (`merchantId`,`createdById`) REFERENCES `employees`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_merchant_voidedById_fk` FOREIGN KEY (`merchantId`,`voidedById`) REFERENCES `employees`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_purchaseOrderId_purchase_orders_id_fk` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_variantId_variants_id_fk` FOREIGN KEY (`variantId`) REFERENCES `variants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_merchant_purchaseOrderId_fk` FOREIGN KEY (`merchantId`,`purchaseOrderId`) REFERENCES `purchase_orders`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_merchant_variantId_fk` FOREIGN KEY (`merchantId`,`variantId`) REFERENCES `variants`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_customerId_customers_id_fk` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_locationId_locations_id_fk` FOREIGN KEY (`locationId`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_createdById_employees_id_fk` FOREIGN KEY (`createdById`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_voidedById_employees_id_fk` FOREIGN KEY (`voidedById`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_merchant_customerId_fk` FOREIGN KEY (`merchantId`,`customerId`) REFERENCES `customers`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_merchant_locationId_fk` FOREIGN KEY (`merchantId`,`locationId`) REFERENCES `locations`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_merchant_createdById_fk` FOREIGN KEY (`merchantId`,`createdById`) REFERENCES `employees`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_merchant_voidedById_fk` FOREIGN KEY (`merchantId`,`voidedById`) REFERENCES `employees`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_saleId_sales_id_fk` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_variantId_variants_id_fk` FOREIGN KEY (`variantId`) REFERENCES `variants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_merchant_saleId_fk` FOREIGN KEY (`merchantId`,`saleId`) REFERENCES `sales`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_merchant_variantId_fk` FOREIGN KEY (`merchantId`,`variantId`) REFERENCES `variants`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_payments` ADD CONSTRAINT `sale_payments_saleId_sales_id_fk` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_payments` ADD CONSTRAINT `sale_payments_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_payments` ADD CONSTRAINT `sale_payments_merchant_saleId_fk` FOREIGN KEY (`merchantId`,`saleId`) REFERENCES `sales`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_products` ADD CONSTRAINT `supplier_products_supplierId_suppliers_id_fk` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_products` ADD CONSTRAINT `supplier_products_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_products` ADD CONSTRAINT `supplier_products_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_products` ADD CONSTRAINT `supplier_products_merchant_supplierId_fk` FOREIGN KEY (`merchantId`,`supplierId`) REFERENCES `suppliers`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_products` ADD CONSTRAINT `supplier_products_merchant_productId_fk` FOREIGN KEY (`merchantId`,`productId`) REFERENCES `products`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variants` ADD CONSTRAINT `variants_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variants` ADD CONSTRAINT `variants_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variants` ADD CONSTRAINT `variants_merchant_productId_fk` FOREIGN KEY (`merchantId`,`productId`) REFERENCES `products`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variant_options` ADD CONSTRAINT `variant_options_variantId_variants_id_fk` FOREIGN KEY (`variantId`) REFERENCES `variants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variant_options` ADD CONSTRAINT `variant_options_optionId_options_id_fk` FOREIGN KEY (`optionId`) REFERENCES `options`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variant_options` ADD CONSTRAINT `variant_options_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variant_options` ADD CONSTRAINT `variant_options_merchant_variantId_fk` FOREIGN KEY (`merchantId`,`variantId`) REFERENCES `variants`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variant_options` ADD CONSTRAINT `variant_options_merchant_optionId_fk` FOREIGN KEY (`merchantId`,`optionId`) REFERENCES `options`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `customers_merchant_id_idx` ON `customers` (`merchantId`);--> statement-breakpoint
CREATE INDEX `inventory_levels_variant_id_idx` ON `inventory_levels` (`variantId`);--> statement-breakpoint
CREATE INDEX `inventory_levels_merchant_id_idx` ON `inventory_levels` (`merchantId`);--> statement-breakpoint
CREATE INDEX `inventory_movements_level_occurred_at_idx` ON `inventory_movements` (`inventoryLevelId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `inventory_movements_created_by_id_idx` ON `inventory_movements` (`createdById`);--> statement-breakpoint
CREATE INDEX `inventory_movements_merchant_id_idx` ON `inventory_movements` (`merchantId`);--> statement-breakpoint
CREATE INDEX `inventory_movements_reference_id_idx` ON `inventory_movements` (`referenceId`);--> statement-breakpoint
CREATE INDEX `inventory_physical_counts_level_occurred_at_idx` ON `inventory_physical_counts` (`inventoryLevelId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `inventory_physical_counts_created_by_id_idx` ON `inventory_physical_counts` (`createdById`);--> statement-breakpoint
CREATE INDEX `inventory_physical_counts_merchant_id_idx` ON `inventory_physical_counts` (`merchantId`);--> statement-breakpoint
CREATE INDEX `locations_merchant_id_idx` ON `locations` (`merchantId`);--> statement-breakpoint
CREATE INDEX `location_access_employee_id_idx` ON `location_access` (`employeeId`);--> statement-breakpoint
CREATE INDEX `location_access_merchant_id_idx` ON `location_access` (`merchantId`);--> statement-breakpoint
CREATE INDEX `options_merchant_id_idx` ON `options` (`merchantId`);--> statement-breakpoint
CREATE INDEX `option_groups_merchant_id_idx` ON `option_groups` (`merchantId`);--> statement-breakpoint
CREATE INDEX `products_collection_id_idx` ON `products` (`collectionId`);--> statement-breakpoint
CREATE INDEX `product_images_product_status_archived_activated_idx` ON `product_images` (`productId`,`status`,`archivedAt`,`activatedAt`,`id`);--> statement-breakpoint
CREATE INDEX `product_images_cleanup_idx` ON `product_images` (`status`,`archivedAt`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `product_option_groups_option_group_id_idx` ON `product_option_groups` (`optionGroupId`);--> statement-breakpoint
CREATE INDEX `product_option_groups_merchant_id_idx` ON `product_option_groups` (`merchantId`);--> statement-breakpoint
CREATE INDEX `purchase_orders_supplier_id_idx` ON `purchase_orders` (`supplierId`);--> statement-breakpoint
CREATE INDEX `purchase_orders_merchant_id_idx` ON `purchase_orders` (`merchantId`);--> statement-breakpoint
CREATE INDEX `purchase_orders_created_by_id_idx` ON `purchase_orders` (`createdById`);--> statement-breakpoint
CREATE INDEX `purchase_orders_voided_by_id_idx` ON `purchase_orders` (`voidedById`);--> statement-breakpoint
CREATE INDEX `purchase_order_items_order_id_idx` ON `purchase_order_items` (`purchaseOrderId`);--> statement-breakpoint
CREATE INDEX `purchase_order_items_variant_id_idx` ON `purchase_order_items` (`variantId`);--> statement-breakpoint
CREATE INDEX `purchase_order_items_merchant_id_idx` ON `purchase_order_items` (`merchantId`);--> statement-breakpoint
CREATE INDEX `sales_customer_id_idx` ON `sales` (`customerId`);--> statement-breakpoint
CREATE INDEX `sales_merchant_id_idx` ON `sales` (`merchantId`);--> statement-breakpoint
CREATE INDEX `sales_created_by_id_idx` ON `sales` (`createdById`);--> statement-breakpoint
CREATE INDEX `sales_voided_by_id_idx` ON `sales` (`voidedById`);--> statement-breakpoint
CREATE INDEX `sale_items_sale_id_idx` ON `sale_items` (`saleId`);--> statement-breakpoint
CREATE INDEX `sale_items_variant_id_idx` ON `sale_items` (`variantId`);--> statement-breakpoint
CREATE INDEX `sale_items_merchant_id_idx` ON `sale_items` (`merchantId`);--> statement-breakpoint
CREATE INDEX `sale_payments_sale_id_idx` ON `sale_payments` (`saleId`);--> statement-breakpoint
CREATE INDEX `sale_payments_merchant_id_idx` ON `sale_payments` (`merchantId`);--> statement-breakpoint
CREATE INDEX `suppliers_merchant_id_idx` ON `suppliers` (`merchantId`);--> statement-breakpoint
CREATE INDEX `supplier_products_product_id_idx` ON `supplier_products` (`productId`);--> statement-breakpoint
CREATE INDEX `supplier_products_merchant_id_idx` ON `supplier_products` (`merchantId`);--> statement-breakpoint
CREATE INDEX `variant_options_option_id_idx` ON `variant_options` (`optionId`);--> statement-breakpoint
CREATE INDEX `variant_options_merchant_id_idx` ON `variant_options` (`merchantId`);--> statement-breakpoint
COMMIT;