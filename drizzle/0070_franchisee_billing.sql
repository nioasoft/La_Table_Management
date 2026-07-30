ALTER TABLE "franchisee"
  ADD COLUMN "royalty_tiers" jsonb;
--> statement-breakpoint
ALTER TABLE "franchisee"
  ADD COLUMN "royalty_tier_basis" text NOT NULL DEFAULT 'gross';
--> statement-breakpoint
ALTER TABLE "franchisee"
  ADD COLUMN "royalty_tiers_confirmed" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "franchisee"
  ADD COLUMN "royalty_include_tips" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "franchisee"
  ADD COLUMN "tips_absence_acknowledged" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "franchisee"
  ADD COLUMN "hashavshevet_account_key" text;
--> statement-breakpoint
ALTER TABLE "franchisee"
  ADD CONSTRAINT "franchisee_royalty_tier_basis_check"
  CHECK ("royalty_tier_basis" IN ('gross', 'net'));
--> statement-breakpoint

CREATE TABLE "franchisee_billing_export" (
  "id" text PRIMARY KEY NOT NULL,
  "brand_id" text NOT NULL,
  "item_type" text NOT NULL,
  "period_year" integer NOT NULL,
  "period_month" integer NOT NULL,
  "exported_at" timestamp NOT NULL DEFAULT now(),
  "exported_by" text,
  "row_count" integer NOT NULL,
  "blob_url" text NOT NULL,
  CONSTRAINT "franchisee_billing_export_brand_id_fk"
    FOREIGN KEY ("brand_id") REFERENCES "brand"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "franchisee_billing_export_exported_by_fk"
    FOREIGN KEY ("exported_by") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "franchisee_billing_export_item_type_check"
    CHECK ("item_type" IN ('royalty', 'marketing')),
  CONSTRAINT "franchisee_billing_export_period_month_check"
    CHECK ("period_month" BETWEEN 1 AND 12),
  CONSTRAINT "franchisee_billing_export_row_count_check"
    CHECK ("row_count" >= 0)
);
--> statement-breakpoint

CREATE TABLE "franchisee_billing" (
  "id" text PRIMARY KEY NOT NULL,
  "franchisee_id" text NOT NULL,
  "period_year" integer NOT NULL,
  "period_month" integer NOT NULL,
  "receipts" numeric(16, 6) NOT NULL,
  "tips" numeric(16, 6) NOT NULL,
  "include_tips" boolean NOT NULL,
  "gross_base" numeric(16, 6) NOT NULL,
  "net_base" numeric(16, 6) NOT NULL,
  "tier_rate" numeric(5, 2) NOT NULL,
  "discount_rate_points" numeric(5, 2) NOT NULL DEFAULT 0,
  "effective_rate" numeric(5, 2) NOT NULL,
  "royalty_full" numeric(16, 6) NOT NULL,
  "royalty" numeric(16, 6) NOT NULL,
  "discount_value" numeric(16, 6) NOT NULL,
  "marketing" numeric(16, 6) NOT NULL,
  "subtotal" numeric(16, 6) NOT NULL,
  "total" numeric(16, 6) NOT NULL,
  "tiers_snapshot" jsonb,
  "tier_basis_snapshot" text,
  "marketing_rate_snapshot" numeric(5, 2),
  "vat_rate_snapshot" numeric(5, 4),
  "account_key_snapshot" text,
  "source_file_id" text,
  "status" text NOT NULL DEFAULT 'draft',
  "approved_at" timestamp,
  "approved_by" text,
  "royalty_exported_at" timestamp,
  "royalty_export_batch_id" text,
  "marketing_exported_at" timestamp,
  "marketing_export_batch_id" text,
  "no_revenue_reason" text,
  CONSTRAINT "franchisee_billing_franchisee_id_fk"
    FOREIGN KEY ("franchisee_id") REFERENCES "franchisee"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "franchisee_billing_source_file_id_fk"
    FOREIGN KEY ("source_file_id") REFERENCES "uploaded_file"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "franchisee_billing_approved_by_fk"
    FOREIGN KEY ("approved_by") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "franchisee_billing_royalty_export_batch_id_fk"
    FOREIGN KEY ("royalty_export_batch_id")
    REFERENCES "franchisee_billing_export"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "franchisee_billing_marketing_export_batch_id_fk"
    FOREIGN KEY ("marketing_export_batch_id")
    REFERENCES "franchisee_billing_export"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "franchisee_billing_period_month_check"
    CHECK ("period_month" BETWEEN 1 AND 12),
  CONSTRAINT "franchisee_billing_status_check"
    CHECK ("status" IN ('draft', 'approved')),
  CONSTRAINT "franchisee_billing_tier_basis_snapshot_check"
    CHECK (
      "tier_basis_snapshot" IS NULL
      OR "tier_basis_snapshot" IN ('gross', 'net')
    ),
  CONSTRAINT "franchisee_billing_discount_rate_check"
    CHECK ("discount_rate_points" >= 0)
);
--> statement-breakpoint

CREATE TABLE "franchisee_deferral_ledger" (
  "id" text PRIMARY KEY NOT NULL,
  "franchisee_id" text NOT NULL,
  "amount" numeric(16, 6) NOT NULL,
  "billing_id" text,
  "note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" text,
  CONSTRAINT "franchisee_deferral_ledger_franchisee_id_fk"
    FOREIGN KEY ("franchisee_id") REFERENCES "franchisee"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "franchisee_deferral_ledger_billing_id_fk"
    FOREIGN KEY ("billing_id") REFERENCES "franchisee_billing"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "franchisee_deferral_ledger_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE UNIQUE INDEX "idx_franchisee_billing_unique_period"
  ON "franchisee_billing"
  ("franchisee_id", "period_year", "period_month");
--> statement-breakpoint
CREATE INDEX "idx_franchisee_billing_period"
  ON "franchisee_billing" ("period_year", "period_month");
--> statement-breakpoint
CREATE INDEX "idx_franchisee_billing_status"
  ON "franchisee_billing" ("status");
--> statement-breakpoint
CREATE INDEX "idx_franchisee_billing_royalty_export_batch"
  ON "franchisee_billing" ("royalty_export_batch_id");
--> statement-breakpoint
CREATE INDEX "idx_franchisee_billing_marketing_export_batch"
  ON "franchisee_billing" ("marketing_export_batch_id");
--> statement-breakpoint
CREATE INDEX "idx_franchisee_billing_export_brand_period"
  ON "franchisee_billing_export" ("brand_id", "period_year", "period_month");
--> statement-breakpoint
CREATE INDEX "idx_franchisee_deferral_ledger_franchisee"
  ON "franchisee_deferral_ledger" ("franchisee_id");
--> statement-breakpoint
CREATE INDEX "idx_franchisee_deferral_ledger_billing"
  ON "franchisee_deferral_ledger" ("billing_id");
--> statement-breakpoint
CREATE INDEX "idx_franchisee_deferral_ledger_created_at"
  ON "franchisee_deferral_ledger" ("created_at");
