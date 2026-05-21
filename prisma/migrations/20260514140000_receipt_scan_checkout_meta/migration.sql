-- Multi-store: group receipt scans from one checkout session; optional store label from client.
ALTER TABLE "ReceiptScan" ADD COLUMN IF NOT EXISTS "purchaseGroupId" TEXT;
ALTER TABLE "ReceiptScan" ADD COLUMN IF NOT EXISTS "checkoutStoreLabel" TEXT;

CREATE INDEX IF NOT EXISTS "ReceiptScan_purchaseGroupId_idx" ON "ReceiptScan"("purchaseGroupId");
