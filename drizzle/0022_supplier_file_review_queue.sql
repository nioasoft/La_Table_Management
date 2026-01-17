-- Supplier File Upload table - Tracks supplier file uploads for review queue
CREATE TABLE IF NOT EXISTS "supplier_file_upload" (
  "id" text PRIMARY KEY NOT NULL,
  "supplier_id" text NOT NULL,
  "original_file_name" text NOT NULL,
  "file_url" text,
  "file_size" integer,
  "file_path" text,
  "processing_status" "uploaded_file_review_status" DEFAULT 'pending' NOT NULL,
  "processing_result" jsonb,
  "reviewed_by" text,
  "reviewed_at" timestamp,
  "review_notes" text,
  "period_start_date" date,
  "period_end_date" date,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by" text,
  CONSTRAINT "supplier_file_upload_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "supplier_file_upload_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "supplier_file_upload_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);

-- Supplier File Blacklist table - Names to exclude from franchisee matching
CREATE TABLE IF NOT EXISTS "supplier_file_blacklist" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "normalized_name" text NOT NULL UNIQUE,
  "supplier_id" text,
  "notes" text,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "supplier_file_blacklist_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "supplier_file_blacklist_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);

-- Create indexes for supplier_file_upload
CREATE INDEX IF NOT EXISTS "idx_supplier_file_upload_supplier" ON "supplier_file_upload" USING btree ("supplier_id");
CREATE INDEX IF NOT EXISTS "idx_supplier_file_upload_status" ON "supplier_file_upload" USING btree ("processing_status");
CREATE INDEX IF NOT EXISTS "idx_supplier_file_upload_created" ON "supplier_file_upload" USING btree ("created_at");

-- Create indexes for supplier_file_blacklist
CREATE INDEX IF NOT EXISTS "idx_supplier_file_blacklist_normalized" ON "supplier_file_blacklist" USING btree ("normalized_name");
CREATE INDEX IF NOT EXISTS "idx_supplier_file_blacklist_supplier" ON "supplier_file_blacklist" USING btree ("supplier_id");
