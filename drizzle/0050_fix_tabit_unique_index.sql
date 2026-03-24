-- Fix tabit_report unique constraint to include client_id
-- Previously: (franchisee_id, period_month, period_year) — only one tabit doc per franchisee
-- Now: (client_id, franchisee_id, period_month, period_year) — one per client per franchisee
DROP INDEX IF EXISTS "idx_client_doc_unique_tabit";
CREATE UNIQUE INDEX "idx_client_doc_unique_tabit" ON "client_document" ("client_id", "franchisee_id", "period_month", "period_year") WHERE "document_type" = 'tabit_report';
