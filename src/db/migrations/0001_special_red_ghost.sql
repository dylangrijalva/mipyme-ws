START TRANSACTION;--> statement-breakpoint
CREATE TABLE `employee_invitations` (
	`id` char(24) NOT NULL,
	`email` varchar(320) NOT NULL,
	`status` varchar(24) NOT NULL DEFAULT 'invited',
	`expiresAt` datetime(6) NOT NULL,
	`acceptedAt` datetime(6),
	`revokedAt` datetime(6),
	`createdAt` datetime(6) NOT NULL,
	`updatedAt` datetime(6) NOT NULL,
	`employeeId` char(24) NOT NULL,
	`invitedById` char(24) NOT NULL,
	`merchantId` char(24) NOT NULL,
	CONSTRAINT `employee_invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_invitations_merchant_id_unique` UNIQUE(`merchantId`,`id`)
);
--> statement-breakpoint
ALTER TABLE `employees` MODIFY COLUMN `status` varchar(24) NOT NULL DEFAULT 'enabled';--> statement-breakpoint
ALTER TABLE `employees` ADD `pin` char(4);--> statement-breakpoint
UPDATE `employees` AS `target` JOIN (SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `merchantId` ORDER BY `createdAt`, `id`) AS `position` FROM `employees`) AS `ranked` ON `ranked`.`id` = `target`.`id` SET `target`.`pin` = LPAD(`ranked`.`position`, 4, '0');--> statement-breakpoint
ALTER TABLE `employees` MODIFY COLUMN `pin` char(4) NOT NULL;--> statement-breakpoint
UPDATE `employees` SET `status` = 'disabled' WHERE `status` = 'invited';--> statement-breakpoint
ALTER TABLE `employee_invitations` ADD CONSTRAINT `employee_invitations_employeeId_employees_id_fk` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_invitations` ADD CONSTRAINT `employee_invitations_invitedById_employees_id_fk` FOREIGN KEY (`invitedById`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_invitations` ADD CONSTRAINT `employee_invitations_merchantId_merchants_id_fk` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_invitations` ADD CONSTRAINT `employee_invitations_merchant_employeeId_fk` FOREIGN KEY (`merchantId`,`employeeId`) REFERENCES `employees`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_invitations` ADD CONSTRAINT `employee_invitations_merchant_invitedById_fk` FOREIGN KEY (`merchantId`,`invitedById`) REFERENCES `employees`(`merchantId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `employee_invitations_email_status_idx` ON `employee_invitations` (`email`,`status`);--> statement-breakpoint
CREATE INDEX `employee_invitations_employee_id_idx` ON `employee_invitations` (`employeeId`);--> statement-breakpoint
CREATE INDEX `employee_invitations_merchant_id_idx` ON `employee_invitations` (`merchantId`);--> statement-breakpoint
COMMIT;