-- CreateTable
CREATE TABLE "BlockedProduct" (
    "id" SERIAL NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blocked_normalizedName_store" ON "BlockedProduct"("normalizedName", "store");

-- CreateIndex
CREATE INDEX "BlockedProduct_store_idx" ON "BlockedProduct"("store");
