-- Declare the client_document dedup / overwrite-guard unique indexes that were
-- previously only in production (added via direct SQL) and missing from
-- schema.ts. This backfills the drift so a fresh DB (staging/local) also gets
-- the constraints. All idempotent — a no-op on production where they exist.
--
-- Matches production:
--   idx_client_doc_gmail_msg      UNIQUE (gmail_message_id) WHERE gmail_message_id IS NOT NULL
--   idx_client_doc_unique_report  UNIQUE (client_id, franchisee_id, period_month, period_year) WHERE document_type = 'client_report'
--   idx_client_doc_unique_tabit   UNIQUE (...) WHERE document_type = 'tabit_report'
--   idx_client_doc_unique_invoice UNIQUE (...) WHERE document_type = 'commission_invoice'
--
-- Journal abandoned past 0056 — applied directly to production.

CREATE UNIQUE INDEX IF NOT EXISTS "idx_client_doc_gmail_msg"
  ON "client_document" USING btree ("gmail_message_id")
  WHERE "gmail_message_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_client_doc_unique_report"
  ON "client_document" USING btree ("client_id","franchisee_id","period_month","period_year")
  WHERE "document_type" = 'client_report';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_client_doc_unique_tabit"
  ON "client_document" USING btree ("client_id","franchisee_id","period_month","period_year")
  WHERE "document_type" = 'tabit_report';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_client_doc_unique_invoice"
  ON "client_document" USING btree ("client_id","franchisee_id","period_month","period_year")
  WHERE "document_type" = 'commission_invoice';
