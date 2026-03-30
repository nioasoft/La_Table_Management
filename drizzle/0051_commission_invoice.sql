-- Add commission_invoice type to client_document_type enum
ALTER TYPE "client_document_type" ADD VALUE IF NOT EXISTS 'commission_invoice';

-- Unique index: one commission invoice per client+franchisee+period
CREATE UNIQUE INDEX IF NOT EXISTS "idx_client_doc_unique_invoice"
  ON "client_document" ("client_id", "franchisee_id", "period_month", "period_year")
  WHERE "document_type" = 'commission_invoice';
