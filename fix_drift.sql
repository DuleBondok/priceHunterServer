-- DropIndex
DROP INDEX "Product_name_store_key";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "normalizedName" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "StandardizedProduct" DROP COLUMN "category",
ADD COLUMN     "mainCategory" TEXT,
ALTER COLUMN "midCategory" SET DATA TYPE TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Product_normalizedName_store_key" ON "Product"("normalizedName", "store");

