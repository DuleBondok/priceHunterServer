-- Faster browse: main + mid category product list (GET standardized-products?...&midCategory=...)
CREATE INDEX IF NOT EXISTS "StandardizedProduct_mainCategory_midCategory_idx" ON "StandardizedProduct"("mainCategory", "midCategory");
