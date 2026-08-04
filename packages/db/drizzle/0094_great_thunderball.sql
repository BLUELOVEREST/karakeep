ALTER TABLE `bookmarkLinks` ADD `crawlErrorSource` text;--> statement-breakpoint
ALTER TABLE `bookmarkLinks` ADD `crawlErrorCode` text;--> statement-breakpoint
ALTER TABLE `bookmarkLinks` ADD `crawlErrorMessage` text;--> statement-breakpoint
ALTER TABLE `bookmarkLinks` ADD `crawlErrorRetryable` integer;--> statement-breakpoint
ALTER TABLE `bookmarkLinks` ADD `crawlErrorAt` integer;