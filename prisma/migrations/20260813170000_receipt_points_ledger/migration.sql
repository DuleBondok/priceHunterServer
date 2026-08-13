-- Receipt rewards / points / challenges: extend ReceiptScan + ledger models.
-- Non-destructive: keeps existing ReceiptScan rows; adds columns and new tables.

-- ReceiptScan: identity, reject, verified totals, points audit
ALTER TABLE "ReceiptScan" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "ReceiptScan" ADD COLUMN IF NOT EXISTS "rejectedBy" TEXT;
ALTER TABLE "ReceiptScan" ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3);
ALTER TABLE "ReceiptScan" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE "ReceiptScan" ADD COLUMN IF NOT EXISTS "confirmedSpentRsd" DECIMAL(65,30);
ALTER TABLE "ReceiptScan" ADD COLUMN IF NOT EXISTS "confirmedSavedRsd" DECIMAL(65,30);
ALTER TABLE "ReceiptScan" ADD COLUMN IF NOT EXISTS "pointsGrantedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ReceiptScan_userId_idx" ON "ReceiptScan"("userId");

CREATE TABLE IF NOT EXISTS "ReceiptConfirmedItem" (
    "id" SERIAL NOT NULL,
    "receiptId" INTEGER NOT NULL,
    "lineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceRsd" DECIMAL(65,30),
    "estimatedSavedRsd" DECIMAL(65,30),
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptConfirmedItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReceiptConfirmedItem_receiptId_lineId_key"
  ON "ReceiptConfirmedItem"("receiptId", "lineId");
CREATE INDEX IF NOT EXISTS "ReceiptConfirmedItem_receiptId_idx"
  ON "ReceiptConfirmedItem"("receiptId");
CREATE INDEX IF NOT EXISTS "ReceiptConfirmedItem_productId_idx"
  ON "ReceiptConfirmedItem"("productId");

DO $$ BEGIN
  ALTER TABLE "ReceiptConfirmedItem"
    ADD CONSTRAINT "ReceiptConfirmedItem_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "ReceiptScan"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "UserPointsAccount" (
    "id" SERIAL NOT NULL,
    "userEmail" TEXT,
    "userId" TEXT,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
    "confirmedReceiptCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPointsAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserPointsAccount_userEmail_key" ON "UserPointsAccount"("userEmail");
CREATE UNIQUE INDEX IF NOT EXISTS "UserPointsAccount_userId_key" ON "UserPointsAccount"("userId");
CREATE INDEX IF NOT EXISTS "UserPointsAccount_userEmail_idx" ON "UserPointsAccount"("userEmail");
CREATE INDEX IF NOT EXISTS "UserPointsAccount_userId_idx" ON "UserPointsAccount"("userId");

DO $$ BEGIN
  CREATE TYPE "PointsTransactionType" AS ENUM (
    'FIRST_CONFIRMED_RECEIPT',
    'CONFIRMED_RECEIPT',
    'CHALLENGE_COMPLETED',
    'REWARD_REDEEMED',
    'ADJUSTMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "UserPointsTransaction" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "PointsTransactionType" NOT NULL,
    "receiptId" INTEGER,
    "challengeId" INTEGER,
    "rewardId" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPointsTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserPointsTransaction_idempotencyKey_key"
  ON "UserPointsTransaction"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "UserPointsTransaction_accountId_createdAt_idx"
  ON "UserPointsTransaction"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "UserPointsTransaction_receiptId_idx"
  ON "UserPointsTransaction"("receiptId");

CREATE TABLE IF NOT EXISTS "Challenge" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "target" INTEGER NOT NULL DEFAULT 1,
    "pointsReward" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Challenge_code_key" ON "Challenge"("code");

CREATE TABLE IF NOT EXISTS "UserChallenge" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "challengeId" INTEGER NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "rewardGrantedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserChallenge_accountId_challengeId_key"
  ON "UserChallenge"("accountId", "challengeId");
CREATE INDEX IF NOT EXISTS "UserChallenge_accountId_idx" ON "UserChallenge"("accountId");

CREATE TABLE IF NOT EXISTS "Reward" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "pointsCost" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Reward_code_key" ON "Reward"("code");

CREATE TABLE IF NOT EXISTS "UserReward" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "rewardId" INTEGER NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "voucherCode" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "UserReward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserReward_accountId_rewardId_key"
  ON "UserReward"("accountId", "rewardId");
CREATE INDEX IF NOT EXISTS "UserReward_accountId_idx" ON "UserReward"("accountId");

-- FKs for points / challenges / rewards (idempotent)
DO $$ BEGIN
  ALTER TABLE "UserPointsTransaction"
    ADD CONSTRAINT "UserPointsTransaction_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "UserPointsAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserPointsTransaction"
    ADD CONSTRAINT "UserPointsTransaction_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "ReceiptScan"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserPointsTransaction"
    ADD CONSTRAINT "UserPointsTransaction_challengeId_fkey"
    FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserPointsTransaction"
    ADD CONSTRAINT "UserPointsTransaction_rewardId_fkey"
    FOREIGN KEY ("rewardId") REFERENCES "Reward"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserChallenge"
    ADD CONSTRAINT "UserChallenge_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "UserPointsAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserChallenge"
    ADD CONSTRAINT "UserChallenge_challengeId_fkey"
    FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserReward"
    ADD CONSTRAINT "UserReward_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "UserPointsAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserReward"
    ADD CONSTRAINT "UserReward_rewardId_fkey"
    FOREIGN KEY ("rewardId") REFERENCES "Reward"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Seed catalog challenges / reward (idempotent)
INSERT INTO "Challenge" ("code", "title", "description", "type", "target", "pointsReward", "isActive", "updatedAt")
VALUES
  (
    'first_confirmed_receipt',
    'Skeniraj prvi račun',
    'Potvrdi prvi fiskalni račun i osvoji bonus poene.',
    'first_confirmed_receipt',
    1,
    0,
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'confirmed_receipts_2',
    'Potvrdi 2 računa',
    'Sakupi 2 admin-potvrđena računa.',
    'confirmed_receipt_count',
    2,
    0,
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'points_to_pavlaka',
    'Sakupi 100 poena',
    'Osvoji besplatnu pavlaku kada sakupiš 100 poena.',
    'points_balance_lifetime',
    100,
    0,
    true,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Reward" ("code", "title", "description", "pointsCost", "isActive", "updatedAt")
VALUES
  (
    'pavlaka',
    'Besplatna pavlaka',
    'Nagrada za sakupljenih 100 poena iz potvrđenih računa.',
    100,
    true,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("code") DO NOTHING;
