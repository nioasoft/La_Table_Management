-- Split-period support for client_document.
--
-- `client_document` holds exactly one client_report per
-- (client, franchisee, period) — enforced by idx_client_doc_unique_report.
-- That matches how platforms normally bill: one report per branch per month.
--
-- Wolt broke the assumption in July 2026 by splitting קינג קונג מוצקין's month
-- into two payouts (01-16/07 and 16/07-01/08). The second file hit the
-- overwrite guard, was parked in the review queue, and the stored figure
-- stayed at ₪97,869 — 54% of the real ₪212,273.
--
-- Rather than widen the unique key (24 files read the one-row-per-slot shape
-- and every consumer would have to learn to aggregate), the parent row stays
-- the single row every consumer already reads, and its totals become the SUM
-- of the parts recorded here. Nothing downstream changes.
CREATE TABLE IF NOT EXISTS "client_document_part" (
    "id" text PRIMARY KEY NOT NULL,
    "client_document_id" text NOT NULL REFERENCES "client_document"("id") ON DELETE CASCADE,
    "original_file_name" text NOT NULL,
    "file_url" text,
    -- Coverage window this part accounts for. Parts of one document must not
    -- overlap: an overlap means the same money twice, which is a conflict to
    -- resolve by hand, not a split to merge.
    "coverage_start" date NOT NULL,
    "coverage_end" date NOT NULL,
    "total_amount" numeric(12, 2),
    "commission_amount" numeric(12, 2),
    "gmail_message_id" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_client_doc_part_unique"
    ON "client_document_part" ("client_document_id", "coverage_start", "coverage_end");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_client_doc_part_doc"
    ON "client_document_part" ("client_document_id");
