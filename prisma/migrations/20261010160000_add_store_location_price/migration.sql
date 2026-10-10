-- CreateTable
CREATE TABLE "StoreLocationPrice" (
    "id" SERIAL NOT NULL,
    "store" TEXT NOT NULL,
    "storeCode" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" TEXT,
    "priceBeforeDiscount" DECIMAL(65,30),
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "offerEndsOn" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreLocationPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreLocationPrice_store_normalizedName_storeCode_key" ON "StoreLocationPrice"("store", "normalizedName", "storeCode");

-- CreateIndex
CREATE INDEX "StoreLocationPrice_store_storeCode_idx" ON "StoreLocationPrice"("store", "storeCode");
