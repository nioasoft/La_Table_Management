-- Add Hashavshevet item key field to franchisee table
-- This field is used in Hashavshevet export for the "מפתח פריט" column
ALTER TABLE "franchisee" ADD COLUMN "hashavshevet_item_key" text;
