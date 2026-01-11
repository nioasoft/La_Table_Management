-- Add isHidden field to suppliers table
-- Hidden suppliers are excluded from commission reports but preserved in database
-- Used for irrelevant suppliers like pest control, insurance, payment processing

ALTER TABLE "supplier" ADD COLUMN "is_hidden" boolean DEFAULT false NOT NULL;

-- Add index for query performance
CREATE INDEX "idx_supplier_is_hidden" ON "supplier" ("is_hidden");
