-- AlterTable
ALTER TABLE "Store" ADD COLUMN "storeCode" TEXT;

-- CreateIndex
CREATE INDEX "Store_storeCode_idx" ON "Store"("storeCode");

-- CreateIndex
CREATE UNIQUE INDEX "Store_name_storeCode_key" ON "Store"("name", "storeCode");
