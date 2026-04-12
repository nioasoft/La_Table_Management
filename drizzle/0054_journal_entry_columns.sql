-- Adds two columns used by the new Hashavshevet "תנועות יומן" (journal entries)
-- per-franchisee export:
--   client.journal_entry_generation   — flag: include this client in the
--                                       journal-entries export (Mishlocha,
--                                       Wolt, HAAT today).
--   client_document.invoice_number    — invoice number extracted from the
--                                       source document by the parser; used
--                                       in the export's "אסמכתא 2" column
--                                       (last 4 digits).

ALTER TABLE "client"
  ADD COLUMN IF NOT EXISTS "journal_entry_generation" boolean NOT NULL DEFAULT false;

ALTER TABLE "client_document"
  ADD COLUMN IF NOT EXISTS "invoice_number" text;
