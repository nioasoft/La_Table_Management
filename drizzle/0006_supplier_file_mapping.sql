-- Migration: Add file mapping configuration to supplier table
-- This allows suppliers to configure how their report files should be parsed

-- Add file_mapping column (JSONB with structured configuration)
ALTER TABLE "supplier" ADD COLUMN IF NOT EXISTS "file_mapping" jsonb;

-- Add comment to describe the expected structure
COMMENT ON COLUMN "supplier"."file_mapping" IS 'Supplier-specific file mapping configuration. Structure: {fileType: "xlsx"|"csv"|"xls", columnMappings: {franchiseeColumn: string, amountColumn: string, dateColumn: string}, headerRow: number, dataStartRow: number, rowsToSkip: number|null, skipKeywords: string[]}';
