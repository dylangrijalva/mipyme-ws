START TRANSACTION;--> statement-breakpoint
ALTER TABLE `products` ADD `inventoryVersion` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
COMMIT;
