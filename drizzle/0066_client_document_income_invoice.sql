-- Add 'income_invoice' to client_document_type.
--
-- Context (2026-06-07): HAAT started (May 2026) sending a monthly order report
-- ("דוח חודשי HAAT", 8xxx_he files) AS WELL AS the existing commission tax
-- invoice ("חשבונית מס מרכזת" SI…). Separately, some franchisees issue their
-- OWN tax invoice TO HAAT via ezcount (10NNN). That franchisee→platform invoice
-- has no natural home in the prior 3-type model and was being misfiled as a
-- commission_invoice (which corrupts commission verification). This type keeps
-- it on record without polluting reconciliation/commission logic, both of which
-- filter on specific document types and therefore ignore 'income_invoice'.
--
-- Applied to production directly via:
--   ALTER TYPE client_document_type ADD VALUE IF NOT EXISTS 'income_invoice';
-- (ADD VALUE cannot run inside a transaction; this file is for record-keeping.)

ALTER TYPE "client_document_type" ADD VALUE IF NOT EXISTS 'income_invoice';
