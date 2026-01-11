-- Add net_amount and vat_adjusted columns to commission table
-- These fields support VAT adjustment during file processing

ALTER TABLE "commission" ADD COLUMN "net_amount" numeric(12, 2);
ALTER TABLE "commission" ADD COLUMN "vat_adjusted" boolean DEFAULT false;

-- Add comment explaining the fields
COMMENT ON COLUMN "commission"."net_amount" IS 'Amount before VAT, used for commission calculation';
COMMENT ON COLUMN "commission"."vat_adjusted" IS 'Whether VAT adjustment was applied when calculating this commission';
