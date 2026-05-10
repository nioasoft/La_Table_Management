-- Per-franchisee override for the journal-entries `חן זכות 1` (revenue
-- account) column in the Hashavshevet export. Replaces the hardcoded
-- FRANCHISEE_REVENUE_OVERRIDES array previously living in
-- /api/reports/hashavshevet/franchisee-journal-entries-export/route.ts.
--
-- When NULL, the export falls back to the global default `הכנסות`. When
-- set (e.g. `הכנסותנ` for נתנזון), that value is written verbatim to
-- column E of the export.
--
-- Added 2026-05-10 as part of the Layer 1 inbound-pipeline hotfix.

ALTER TABLE "franchisee"
  ADD COLUMN IF NOT EXISTS "hashavshevet_revenue_account" text;
--> statement-breakpoint
-- Seed Netanzon Azrieli Haifa with its existing override so behaviour is
-- preserved on day one (operating-brand id pinned in
-- src/lib/franchisee-parent-map.ts).
UPDATE "franchisee"
   SET "hashavshevet_revenue_account" = 'הכנסותנ'
 WHERE "id" = 'ab020323-fefe-4543-9a69-16d14dd54b99'
   AND "hashavshevet_revenue_account" IS NULL;
