-- AlterTable
ALTER TABLE "CatalogBrand" ADD COLUMN IF NOT EXISTS "matchName" TEXT;

UPDATE "CatalogBrand" SET "matchName" = "name" WHERE "matchName" IS NULL OR TRIM("matchName") = '';

ALTER TABLE "CatalogBrand" ALTER COLUMN "matchName" SET NOT NULL;

DROP INDEX IF EXISTS "CatalogBrand_name_key";

CREATE UNIQUE INDEX IF NOT EXISTS "CatalogBrand_matchName_key" ON "CatalogBrand"("matchName");
