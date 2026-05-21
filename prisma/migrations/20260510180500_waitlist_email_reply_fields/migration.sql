-- AlterTable
ALTER TABLE "WaitlistEmail" ADD COLUMN "repliedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WaitlistEmail" ADD COLUMN "repliedBy" TEXT;

-- CreateIndex
CREATE INDEX "WaitlistEmail_repliedAt_idx" ON "WaitlistEmail"("repliedAt");
