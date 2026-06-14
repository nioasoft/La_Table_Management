-- Per-client override for the Hashavshevet "item key" (מפתח פריט) in the
-- client-invoices export. Replaces the hardcoded LATABLEMARK → "ארוחותש"
-- special case that previously lived in
-- /api/reports/hashavshevet/franchisee-client-invoices-export/route.ts.
--
-- Resolution priority (first non-empty wins):
--   1. hashavshevet_item_key_by_brand[brandId]   (per client + per brand)
--   2. hashavshevet_item_key                       (per client, global)
--   3. franchisee.hashavshevet_revenue_account     (per franchisee)
--   4. default "ארוחות"
--
-- Added 2026-06-14. Journal abandoned past 0056 — applied directly to production.

ALTER TABLE "client"
  ADD COLUMN IF NOT EXISTS "hashavshevet_item_key" text;
--> statement-breakpoint
ALTER TABLE "client"
  ADD COLUMN IF NOT EXISTS "hashavshevet_item_key_by_brand" jsonb;
--> statement-breakpoint
-- Seed LATABLEMARK with its existing item key so behaviour is preserved on
-- day one (this used to be the only hardcoded special case in the route).
UPDATE "client"
   SET "hashavshevet_item_key" = 'ארוחותש'
 WHERE "code" = 'LATABLEMARK'
   AND "hashavshevet_item_key" IS NULL;
