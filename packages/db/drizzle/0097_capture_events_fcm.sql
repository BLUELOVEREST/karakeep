CREATE TABLE `captureEvent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`eventKey` text NOT NULL,
	`userId` text NOT NULL,
	`bookmarkId` text,
	`type` text NOT NULL,
	`platform` text NOT NULL,
	`code` text,
	`message` text NOT NULL,
	`retryable` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `captureEvent_eventKey_unique` ON `captureEvent` (`eventKey`);--> statement-breakpoint
CREATE INDEX `captureEvent_user_cursor_idx` ON `captureEvent` (`userId`,`id`);--> statement-breakpoint
CREATE TABLE `captureState` (
	`bookmarkId` text PRIMARY KEY NOT NULL,
	`attemptId` text,
	`phase` text NOT NULL,
	`unresolved` integer DEFAULT false NOT NULL,
	`errorCode` text,
	`source` text,
	`retryable` integer,
	`startedAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`bookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pushDelivery` (
	`id` text PRIMARY KEY NOT NULL,
	`eventId` integer NOT NULL,
	`deviceId` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`availableAt` integer NOT NULL,
	`leaseUntil` integer,
	`leaseId` text,
	`lastError` text,
	FOREIGN KEY (`eventId`) REFERENCES `captureEvent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deviceId`) REFERENCES `pushDevice`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pushDelivery_due_idx` ON `pushDelivery` (`state`,`availableAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `pushDelivery_event_device_unique` ON `pushDelivery` (`eventId`,`deviceId`);--> statement-breakpoint
CREATE TABLE `pushDevice` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`apiKeyId` text,
	`token` text NOT NULL,
	`scope` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`modifiedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`apiKeyId`) REFERENCES `apiKey`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pushDevice_token_unique` ON `pushDevice` (`token`);--> statement-breakpoint
CREATE INDEX `pushDevice_user_idx` ON `pushDevice` (`userId`);
