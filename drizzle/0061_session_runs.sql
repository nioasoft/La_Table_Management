-- Reconciliation V2: session run versioning
-- Adds run_number, parent_session_id, archived_at to support Match-All clone workflow.
-- Replaces the unique (supplier, period) constraint with (supplier, period, run_number)
-- and adds a partial index for fast lookup of the active (non-archived) session.
--
-- Note: production has the unique constraint named `reconciliation_session_supplier_period_unique`,
-- but schema.ts named the index `idx_reconciliation_session_unique`. Both forms are dropped safely.

ALTER TABLE reconciliation_session
  ADD COLUMN IF NOT EXISTS run_number INTEGER NOT NULL DEFAULT 1;

ALTER TABLE reconciliation_session
  ADD COLUMN IF NOT EXISTS parent_session_id TEXT REFERENCES reconciliation_session(id) ON DELETE SET NULL;

ALTER TABLE reconciliation_session
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE;

-- Drop the old (supplier, period) unique constraint / index — both possible names.
ALTER TABLE reconciliation_session
  DROP CONSTRAINT IF EXISTS reconciliation_session_supplier_period_unique;

DROP INDEX IF EXISTS idx_reconciliation_session_unique;
DROP INDEX IF EXISTS reconciliation_session_supplier_period_unique;

-- New unique index including run_number — allows multiple runs per (supplier, period).
CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliation_session_unique_run
  ON reconciliation_session (supplier_id, period_start_date, period_end_date, run_number);

-- Partial index: fast lookup of the single active (non-archived) session per (supplier, period).
CREATE INDEX IF NOT EXISTS idx_reconciliation_session_active
  ON reconciliation_session (supplier_id, period_start_date, period_end_date)
  WHERE archived_at IS NULL;
