-- Allow client_reconciliation_approval rows to exist without an approval,
-- so per-row notes can be added independently of approval state.
ALTER TABLE "client_reconciliation_approval"
  ALTER COLUMN "approved_by" DROP NOT NULL;
