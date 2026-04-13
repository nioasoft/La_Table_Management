CREATE TABLE IF NOT EXISTS "occasional_client" (
  "id" text PRIMARY KEY NOT NULL,
  "tabit_column_name" text NOT NULL,
  "tabit_column_key" text NOT NULL,
  "hashavshevet_code" text,
  "hashavshevet_name" text,
  "ignored" boolean NOT NULL DEFAULT false,
  "first_seen_period_month" integer,
  "first_seen_period_year" integer,
  "first_seen_at" timestamp NOT NULL DEFAULT now(),
  "notes" text,
  "created_by" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "fk_occ_client_created_by" FOREIGN KEY ("created_by")
    REFERENCES "user"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_occasional_client_key"
  ON "occasional_client" ("tabit_column_key");

CREATE INDEX IF NOT EXISTS "idx_occasional_client_ignored"
  ON "occasional_client" ("ignored");

CREATE TABLE IF NOT EXISTS "occasional_client_document" (
  "id" text PRIMARY KEY NOT NULL,
  "occasional_client_id" text NOT NULL,
  "franchisee_id" text NOT NULL,
  "period_month" integer NOT NULL,
  "period_year" integer NOT NULL,
  "total_amount" numeric(14, 2) NOT NULL,
  "source_tabit_file_url" text,
  "source_tabit_file_name" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "fk_occ_client_doc_client" FOREIGN KEY ("occasional_client_id")
    REFERENCES "occasional_client"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_occ_client_doc_franchisee" FOREIGN KEY ("franchisee_id")
    REFERENCES "franchisee"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_occ_client_doc_uniq"
  ON "occasional_client_document"
  ("occasional_client_id", "franchisee_id", "period_month", "period_year");

CREATE INDEX IF NOT EXISTS "idx_occ_client_doc_franchisee_period"
  ON "occasional_client_document" ("franchisee_id", "period_year", "period_month");
