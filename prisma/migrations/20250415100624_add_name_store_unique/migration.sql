/*
  Warnings:

  - A unique constraint covering the columns `[name,store]` on the table `Product` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Product_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "Product_name_store_key" ON "Product"("name", "store");
