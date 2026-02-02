-- Add hashavshevet_code column to supplier table
-- This field stores the supplier's code in the Hashavshevet accounting system
-- Used for exporting commission data for import into Hashavshevet

ALTER TABLE "supplier" ADD COLUMN "hashavshevet_code" text;
