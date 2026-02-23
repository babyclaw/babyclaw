CREATE TABLE `Secret` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`label` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
