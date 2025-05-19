/*
  Warnings:

  - You are about to drop the column `normalizedName` on the `Product` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Product" DROP COLUMN "normalizedName",
ADD COLUMN     "standardizedProductId" INTEGER;

-- CreateTable
CREATE TABLE "StandardizedProduct" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "category" TEXT,
    "subCategory" TEXT,
    "brand" TEXT,
    "volume" TEXT,
    "attributes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandardizedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StandardizedProduct_name_key" ON "StandardizedProduct"("name");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_standardizedProductId_fkey" FOREIGN KEY ("standardizedProductId") REFERENCES "StandardizedProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
