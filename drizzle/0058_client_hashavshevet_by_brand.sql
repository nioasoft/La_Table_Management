-- Per-brand override for the Hashavshevet account name on `client`.
-- Keyed by brand.id (UUID). When a row in the export belongs to a franchisee
-- of that brand, use the mapped value instead of `hashavshevet_code` /
-- `hashavshevet_name` / `name`.
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "hashavshevet_by_brand" jsonb;
