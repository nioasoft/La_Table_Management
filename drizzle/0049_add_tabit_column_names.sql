-- Add tabit_column_names to client table
-- Maps Tabit pivot table payment method columns to this client
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "tabit_column_names" jsonb;

-- Populate for known clients
UPDATE "client" SET "tabit_column_names" = '["סיבוס","סיבוס Online","סיבוס אונליין"]' WHERE "code" = 'CIBUS';
UPDATE "client" SET "tabit_column_names" = '["תן ביס","תן ביס Online"]' WHERE "code" = 'TENBIS';
UPDATE "client" SET "tabit_column_names" = '["Wolt"]' WHERE "code" = 'WOLT';
UPDATE "client" SET "tabit_column_names" = '["HAAT"]' WHERE "code" = 'HAAT';
UPDATE "client" SET "tabit_column_names" = '["משלוחה","משלוחה online"]' WHERE "code" = 'MISHLOCHA';
