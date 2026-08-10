CREATE TABLE `resolverRuntimeConfig` (
	`resolverId` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`createdAt` integer NOT NULL,
	`modifiedAt` integer,
	`updatedBy` text,
	PRIMARY KEY(`resolverId`, `key`),
	FOREIGN KEY (`updatedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
