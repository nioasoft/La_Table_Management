CREATE TABLE IF NOT EXISTS "supplier_file_processing_diagnostics" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_file_upload_id" text,
	"supplier_id" text,
	"file_name" text NOT NULL,
	"file_size_bytes" integer,
	"file_sha256" text,
	"franchisees_snapshot_count" integer,
	"aliases_snapshot_count" integer,
	"match_stats" jsonb,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "supplier_file_processing_diagnostics"
		ADD CONSTRAINT "supplier_file_processing_diagnostics_supplier_id_supplier_id_fk"
		FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spfd_supplier_id_idx"
	ON "supplier_file_processing_diagnostics" ("supplier_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spfd_processed_at_idx"
	ON "supplier_file_processing_diagnostics" ("processed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spfd_file_sha256_idx"
	ON "supplier_file_processing_diagnostics" ("file_sha256");
