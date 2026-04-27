-- Israeli tax allocation number (מספר הקצאה) on client_document.
-- 9 digits, required by Israeli tax law on invoices over the threshold
-- (₪10,000 today, dropping to ₪5,000). Extracted by invoice parsers and
-- surfaced in the Hashavshevet journal-entries export (column K).
ALTER TABLE "client_document" ADD COLUMN IF NOT EXISTS "allocation_number" text;
