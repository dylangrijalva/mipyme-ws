START TRANSACTION;--> statement-breakpoint
ALTER TABLE `inventory_levels` ADD `lastSoldAt` datetime(6);--> statement-breakpoint
ALTER TABLE `inventory_levels` ADD `lastRestockAt` datetime(6);--> statement-breakpoint
ALTER TABLE `inventory_levels` ADD `lastInventoryAdjustmentAt` datetime(6);--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `lastInventoryChangedAt`;--> statement-breakpoint
COMMIT;
