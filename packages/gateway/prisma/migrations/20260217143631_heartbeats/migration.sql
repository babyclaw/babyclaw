-- CreateTable
CREATE TABLE "HeartbeatRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "outcome" TEXT NOT NULL,
    "summary" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "HeartbeatRun_createdAt_idx" ON "HeartbeatRun"("createdAt");
