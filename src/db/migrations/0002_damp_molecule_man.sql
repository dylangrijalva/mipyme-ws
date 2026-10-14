START TRANSACTION;--> statement-breakpoint
ALTER TABLE `employees` ADD `maxDiscountRate` decimal(3,2) unsigned DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `locations` ADD `exchangeRate` decimal(12,2) unsigned DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `businessDate` datetime(3);
--> statement-breakpoint
UPDATE `sales` SET `businessDate` = `createdAt`;
--> statement-breakpoint
ALTER TABLE `sales` MODIFY `businessDate` datetime(3) NOT NULL;--> statement-breakpoint
COMMIT;
