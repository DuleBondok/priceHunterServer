/*
  Warnings:

  - A unique constraint covering the columns `[name,store]` on the table `Product` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
-- Idempotent: migracija 20250414133028 nikad nije uspešno primenjena (dupla imena), indeks ne mora postojati.
DROP INDEX IF EXISTS "Product_name_key";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Product_name_store_key" ON "Product"("name", "store");
