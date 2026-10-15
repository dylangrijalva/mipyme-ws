ALTER TABLE `products` ADD `lastSoldAt` datetime(6);--> statement-breakpoint
ALTER TABLE `products` ADD `lastInventoryChangedAt` datetime(6);--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `voidedById` char(24);--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `voidedAt` datetime(6);--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `voidReason` varchar(256);--> statement-breakpoint
ALTER TABLE `purchase_order_items` ADD `previousUnitCost` decimal(12,2) unsigned;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_voidedById_employees_id_fk` FOREIGN KEY (`voidedById`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_merchant_voidedById_fk` FOREIGN KEY (`merchantId`,`voidedById`) REFERENCES `employees`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `purchase_orders_voided_by_id_idx` ON `purchase_orders` (`voidedById`);--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `inventoryVersion`;