-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "platformChatId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "alias" TEXT,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "linkedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "threadId" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" BIGINT NOT NULL,
    "createdByUserId" BIGINT NOT NULL,
    "threadId" BIGINT,
    "directMessagesTopicId" BIGINT,
    "title" TEXT,
    "taskPrompt" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "cronExpression" TEXT,
    "runAt" DATETIME,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "nextRunAt" DATETIME,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "targetChatRef" TEXT,
    "canceledAt" DATETIME
);

-- CreateTable
CREATE TABLE "ScheduleRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "scheduledFor" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "sessionKey" TEXT,
    "assistantMessageId" BIGINT,
    "error" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduleRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TelegramMessageLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" BIGINT NOT NULL,
    "messageId" BIGINT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "scheduleId" TEXT,
    "scheduleRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramMessageLink_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TelegramMessageLink_scheduleRunId_fkey" FOREIGN KEY ("scheduleRunId") REFERENCES "ScheduleRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Chat_platform_platformChatId_key" ON "Chat"("platform", "platformChatId");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_platform_alias_key" ON "Chat"("platform", "alias");

-- CreateIndex
CREATE UNIQUE INDEX "Session_key_key" ON "Session"("key");

-- CreateIndex
CREATE INDEX "Message_sessionId_createdAt_idx" ON "Message"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "Schedule_chatId_status_nextRunAt_idx" ON "Schedule"("chatId", "status", "nextRunAt");

-- CreateIndex
CREATE INDEX "ScheduleRun_scheduleId_createdAt_idx" ON "ScheduleRun"("scheduleId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduleRun_status_createdAt_idx" ON "ScheduleRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduleRun_sessionKey_idx" ON "ScheduleRun"("sessionKey");

-- CreateIndex
CREATE INDEX "TelegramMessageLink_sessionKey_idx" ON "TelegramMessageLink"("sessionKey");

-- CreateIndex
CREATE INDEX "TelegramMessageLink_scheduleId_idx" ON "TelegramMessageLink"("scheduleId");

-- CreateIndex
CREATE INDEX "TelegramMessageLink_scheduleRunId_idx" ON "TelegramMessageLink"("scheduleRunId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramMessageLink_chatId_messageId_key" ON "TelegramMessageLink"("chatId", "messageId");
