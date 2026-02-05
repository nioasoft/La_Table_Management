CREATE TABLE IF NOT EXISTS "franchisee_bkmv_year" (
	"id" text PRIMARY KEY NOT NULL,
	"franchisee_id" text NOT NULL,
	"year" integer NOT NULL,
	"monthly_breakdown" jsonb NOT NULL,
	"supplier_matches" jsonb,
	"month_count" integer DEFAULT 0 NOT NULL,
	"months_covered" jsonb,
	"is_complete" boolean DEFAULT false NOT NULL,
	"latest_source_file_id" text,
	"source_file_ids" jsonb,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "franchisee_bkmv_year" ADD CONSTRAINT "franchisee_bkmv_year_franchisee_id_franchisee_id_fk" FOREIGN KEY ("franchisee_id") REFERENCES "public"."franchisee"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "franchisee_bkmv_year" ADD CONSTRAINT "franchisee_bkmv_year_latest_source_file_id_uploaded_file_id_fk" FOREIGN KEY ("latest_source_file_id") REFERENCES "public"."uploaded_file"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_franchisee_bkmv_year_unique" ON "franchisee_bkmv_year" USING btree ("franchisee_id","year");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_franchisee_bkmv_year_franchisee" ON "franchisee_bkmv_year" USING btree ("franchisee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_franchisee_bkmv_year_year" ON "franchisee_bkmv_year" USING btree ("year");
