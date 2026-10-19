-- CreateTable
CREATE TABLE "ScrapeRunRecord" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapeRunRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScrapeRunRecord_startedAt_idx" ON "ScrapeRunRecord"("startedAt");

-- CreateIndex
CREATE INDEX "ScrapeRunRecord_status_idx" ON "ScrapeRunRecord"("status");
