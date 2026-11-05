CREATE TABLE `userAIConfig` (
	`userId` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`provider` text NOT NULL,
	`baseUrl` text NOT NULL,
	`textModel` text NOT NULL,
	`imageModel` text,
	`outputSchema` text NOT NULL,
	`useMaxCompletionTokens` integer DEFAULT false NOT NULL,
	`encryptedApiKey` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
