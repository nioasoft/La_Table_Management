CREATE TABLE IF NOT EXISTS "client_reconciliation_approval" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "client"("id") ON DELETE CASCADE,
  "franchisee_id" text NOT NULL REFERENCES "franchisee"("id") ON DELETE CASCADE,
  "period_month" integer NOT NULL,
  "period_year" integer NOT NULL,
  "approved_by" text NOT NULL REFERENCES "user"("id"),
  "approved_at" timestamp NOT NULL DEFAULT now(),
  "notes" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "client_reconciliation_approval_unq"
  ON "client_reconciliation_approval"
  ("client_id", "franchisee_id", "period_month", "period_year");

CREATE INDEX IF NOT EXISTS "idx_client_reconciliation_approval_franchisee_period"
  ON "client_reconciliation_approval"
  ("franchisee_id", "period_month", "period_year");
