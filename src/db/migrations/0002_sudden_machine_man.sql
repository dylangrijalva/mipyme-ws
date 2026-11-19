START TRANSACTION;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD `notes` varchar(256);--> statement-breakpoint
CREATE INDEX `inventory_movements_level_occurred_at_delta_idx` ON `inventory_movements` (`inventoryLevelId`,`occurredAt`,`id`,`quantityDelta`);--> statement-breakpoint
CREATE INDEX `inventory_movements_merchant_occurred_at_idx` ON `inventory_movements` (`merchantId`,`occurredAt`,`id`);--> statement-breakpoint
DROP INDEX `inventory_movements_level_occurred_at_idx` ON `inventory_movements`;--> statement-breakpoint
DROP INDEX `inventory_movements_merchant_id_idx` ON `inventory_movements`;--> statement-breakpoint
COMMIT;
