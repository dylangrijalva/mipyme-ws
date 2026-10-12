ALTER TABLE `products` ADD `lastRestockAt` datetime(6);--> statement-breakpoint
ALTER TABLE `sales` ADD `voidedAt` datetime(6);--> statement-breakpoint
ALTER TABLE `sales` ADD `voidReason` varchar(256);