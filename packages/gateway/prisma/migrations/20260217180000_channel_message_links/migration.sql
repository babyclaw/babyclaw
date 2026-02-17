-- CreateTable
CREATE TABLE "ChannelMessageLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "platformChatId" TEXT NOT NULL,
    "platformMessageId" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "scheduleId" TEXT,
    "scheduleRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelMessageLink_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ChannelMessageLink_scheduleRunId_fkey" FOREIGN KEY ("scheduleRunId") REFERENCES "ScheduleRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Backfill existing TelegramMessageLink rows into the new table
INSERT INTO "ChannelMessageLink" ("id", "platform", "platformChatId", "platformMessageId", "sessionKey", "scheduleId", "scheduleRunId", "createdAt")
SELECT "id", 'telegram', CAST("chatId" AS TEXT), CAST("messageId" AS TEXT), "sessionKey", "scheduleId", "scheduleRunId", "createdAt"
FROM "TelegramMessageLink";

-- DropTable
DROP TABLE "TelegramMessageLink";

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMessageLink_platform_platformChatId_platformMessageId_key" ON "ChannelMessageLink"("platform", "platformChatId", "platformMessageId");

-- CreateIndex
CREATE INDEX "ChannelMessageLink_sessionKey_idx" ON "ChannelMessageLink"("sessionKey");

-- CreateIndex
CREATE INDEX "ChannelMessageLink_scheduleId_idx" ON "ChannelMessageLink"("scheduleId");

-- CreateIndex
CREATE INDEX "ChannelMessageLink_scheduleRunId_idx" ON "ChannelMessageLink"("scheduleRunId");
