CREATE TABLE `ChannelMessageLink` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`platformChatId` text NOT NULL,
	`platformMessageId` text NOT NULL,
	`sessionKey` text NOT NULL,
	`scheduleId` text,
	`scheduleRunId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`scheduleId`) REFERENCES `Schedule`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`scheduleRunId`) REFERENCES `ScheduleRun`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ChannelMessageLink_platform_chatId_messageId_key` ON `ChannelMessageLink` (`platform`,`platformChatId`,`platformMessageId`);--> statement-breakpoint
CREATE INDEX `ChannelMessageLink_sessionKey_idx` ON `ChannelMessageLink` (`sessionKey`);--> statement-breakpoint
CREATE INDEX `ChannelMessageLink_scheduleId_idx` ON `ChannelMessageLink` (`scheduleId`);--> statement-breakpoint
CREATE INDEX `ChannelMessageLink_scheduleRunId_idx` ON `ChannelMessageLink` (`scheduleRunId`);--> statement-breakpoint
CREATE TABLE `Chat` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`platformChatId` text NOT NULL,
	`type` text NOT NULL,
	`title` text,
	`alias` text,
	`isMain` integer DEFAULT false NOT NULL,
	`linkedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Chat_platform_platformChatId_key` ON `Chat` (`platform`,`platformChatId`);--> statement-breakpoint
CREATE UNIQUE INDEX `Chat_platform_alias_key` ON `Chat` (`platform`,`alias`);--> statement-breakpoint
CREATE TABLE `HeartbeatRun` (
	`id` text PRIMARY KEY NOT NULL,
	`startedAt` integer NOT NULL,
	`finishedAt` integer,
	`outcome` text NOT NULL,
	`summary` text,
	`error` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `HeartbeatRun_createdAt_idx` ON `HeartbeatRun` (`createdAt`);--> statement-breakpoint
CREATE TABLE `Message` (
	`id` text PRIMARY KEY NOT NULL,
	`sessionId` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `Message_sessionId_createdAt_idx` ON `Message` (`sessionId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `ScheduleRun` (
	`id` text PRIMARY KEY NOT NULL,
	`scheduleId` text NOT NULL,
	`scheduledFor` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`sessionKey` text,
	`assistantMessageId` integer,
	`error` text,
	`startedAt` integer,
	`finishedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`scheduleId`) REFERENCES `Schedule`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ScheduleRun_scheduleId_createdAt_idx` ON `ScheduleRun` (`scheduleId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `ScheduleRun_status_createdAt_idx` ON `ScheduleRun` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `ScheduleRun_sessionKey_idx` ON `ScheduleRun` (`sessionKey`);--> statement-breakpoint
CREATE TABLE `Schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`chatId` integer NOT NULL,
	`createdByUserId` integer NOT NULL,
	`threadId` integer,
	`directMessagesTopicId` integer,
	`title` text,
	`taskPrompt` text NOT NULL,
	`sourceText` text NOT NULL,
	`type` text NOT NULL,
	`cronExpression` text,
	`runAt` integer,
	`timezone` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`nextRunAt` integer,
	`lastRunAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`targetChatRef` text,
	`canceledAt` integer
);
--> statement-breakpoint
CREATE INDEX `Schedule_chatId_status_nextRunAt_idx` ON `Schedule` (`chatId`,`status`,`nextRunAt`);--> statement-breakpoint
CREATE TABLE `Session` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`chatId` integer NOT NULL,
	`threadId` integer,
	`title` text,
	`workingMemory` text,
	`lastActivityAt` integer,
	`memoriesLastExtractedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Session_key_unique` ON `Session` (`key`);