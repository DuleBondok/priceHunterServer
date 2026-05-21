-- Brži upiti: GET ...?attributeKey=Health option&attributeValue=... (Biraj zdravije)
CREATE INDEX IF NOT EXISTS "StandardizedProduct_health_option_attr_lower_idx"
ON "StandardizedProduct" (LOWER(TRIM(("attributes"->>'Health option'))))
WHERE "attributes" IS NOT NULL;
