CREATE TYPE "public"."adjustment_type" AS ENUM('credit', 'debit', 'refund', 'penalty', 'bonus');--> statement-breakpoint
CREATE TYPE "public"."commission_status" AS ENUM('pending', 'calculated', 'approved', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('draft', 'active', 'expired', 'archived');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('pending', 'sent', 'delivered', 'failed', 'bounced');--> statement-breakpoint
CREATE TYPE "public"."franchisee_status" AS ENUM('active', 'inactive', 'pending', 'suspended', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('pending', 'sent', 'acknowledged', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."reminder_type" AS ENUM('document_expiry', 'settlement', 'commission', 'custom');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('draft', 'pending', 'approved', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."upload_link_status" AS ENUM('active', 'expired', 'used', 'cancelled');--> statement-breakpoint
CREATE TABLE "adjustment" (
	"id" text PRIMARY KEY NOT NULL,
	"settlement_period_id" text NOT NULL,
	"adjustment_type" "adjustment_type" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"description" text,
	"reference_number" text,
	"effective_date" date,
	"metadata" jsonb,
	"approved_at" timestamp,
	"approved_by" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "brand" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"logo_url" text,
	"website" text,
	"contact_email" text,
	"contact_phone" text,
	"address" text,
	"is_active" boolean NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_by" text,
	CONSTRAINT "brand_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "commission" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"franchisee_id" text NOT NULL,
	"settlement_period_id" text,
	"period_start_date" date NOT NULL,
	"period_end_date" date NOT NULL,
	"status" "commission_status" NOT NULL,
	"gross_amount" numeric(12, 2) NOT NULL,
	"commission_rate" numeric(5, 2) NOT NULL,
	"commission_amount" numeric(12, 2) NOT NULL,
	"invoice_number" text,
	"invoice_date" date,
	"notes" text,
	"metadata" jsonb,
	"calculated_at" timestamp,
	"approved_at" timestamp,
	"approved_by" text,
	"paid_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "cross_reference" (
	"id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reference_code" text,
	"reference_type" text,
	"description" text,
	"metadata" jsonb,
	"is_active" boolean NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"document_type" text NOT NULL,
	"status" "document_status" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"file_url" text,
	"file_name" text,
	"file_size" integer,
	"mime_type" text,
	"version" integer NOT NULL,
	"effective_date" date,
	"expiration_date" date,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text,
	"to_email" text NOT NULL,
	"to_name" text,
	"from_email" text NOT NULL,
	"from_name" text,
	"subject" text NOT NULL,
	"body_html" text,
	"body_text" text,
	"status" "email_status" NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"message_id" text,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"failed_at" timestamp,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "email_template" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"body_text" text,
	"description" text,
	"category" text,
	"variables" jsonb,
	"is_active" boolean NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_by" text,
	CONSTRAINT "email_template_name_unique" UNIQUE("name"),
	CONSTRAINT "email_template_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "franchisee" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"owner_name" text,
	"contact_email" text,
	"contact_phone" text,
	"address" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text,
	"status" "franchisee_status" NOT NULL,
	"agreement_start_date" date,
	"agreement_end_date" date,
	"royalty_rate" numeric(5, 2),
	"marketing_fee_rate" numeric(5, 2),
	"notes" text,
	"is_active" boolean NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_by" text,
	CONSTRAINT "franchisee_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "franchisee_status_history" (
	"id" text PRIMARY KEY NOT NULL,
	"franchisee_id" text NOT NULL,
	"previous_status" "franchisee_status",
	"new_status" "franchisee_status" NOT NULL,
	"effective_date" date NOT NULL,
	"reason" text,
	"notes" text,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "reminder" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"reminder_type" "reminder_type" NOT NULL,
	"status" "reminder_status" NOT NULL,
	"due_date" timestamp NOT NULL,
	"remind_at" timestamp NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"assigned_to" text,
	"acknowledged_at" timestamp,
	"acknowledged_by" text,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "settlement_period" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"franchisee_id" text NOT NULL,
	"period_start_date" date NOT NULL,
	"period_end_date" date NOT NULL,
	"status" "settlement_status" NOT NULL,
	"gross_sales" numeric(12, 2),
	"net_sales" numeric(12, 2),
	"royalty_amount" numeric(12, 2),
	"marketing_fee_amount" numeric(12, 2),
	"total_deductions" numeric(12, 2),
	"total_adjustments" numeric(12, 2),
	"net_payable" numeric(12, 2),
	"due_date" date,
	"paid_date" date,
	"notes" text,
	"metadata" jsonb,
	"approved_at" timestamp,
	"approved_by" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"address" text,
	"tax_id" text,
	"payment_terms" text,
	"default_commission_rate" numeric(5, 2),
	"is_active" boolean NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_by" text,
	CONSTRAINT "supplier_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "supplier_commission_history" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"previous_rate" numeric(5, 2),
	"new_rate" numeric(5, 2) NOT NULL,
	"effective_date" date NOT NULL,
	"reason" text,
	"notes" text,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "upload_link" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "upload_link_status" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"allowed_file_types" text,
	"max_file_size" integer,
	"max_files" integer NOT NULL,
	"expires_at" timestamp,
	"used_at" timestamp,
	"used_by_email" text,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_by" text,
	CONSTRAINT "upload_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "uploaded_file" (
	"id" text PRIMARY KEY NOT NULL,
	"upload_link_id" text NOT NULL,
	"file_name" text NOT NULL,
	"original_file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"checksum" text,
	"uploaded_by_email" text,
	"uploaded_by_ip" text,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_settlement_period_id_settlement_period_id_fk" FOREIGN KEY ("settlement_period_id") REFERENCES "public"."settlement_period"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand" ADD CONSTRAINT "brand_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission" ADD CONSTRAINT "commission_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission" ADD CONSTRAINT "commission_franchisee_id_franchisee_id_fk" FOREIGN KEY ("franchisee_id") REFERENCES "public"."franchisee"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission" ADD CONSTRAINT "commission_settlement_period_id_settlement_period_id_fk" FOREIGN KEY ("settlement_period_id") REFERENCES "public"."settlement_period"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission" ADD CONSTRAINT "commission_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission" ADD CONSTRAINT "commission_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_reference" ADD CONSTRAINT "cross_reference_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_template_id_email_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_template" ADD CONSTRAINT "email_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchisee" ADD CONSTRAINT "franchisee_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchisee" ADD CONSTRAINT "franchisee_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchisee_status_history" ADD CONSTRAINT "franchisee_status_history_franchisee_id_franchisee_id_fk" FOREIGN KEY ("franchisee_id") REFERENCES "public"."franchisee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchisee_status_history" ADD CONSTRAINT "franchisee_status_history_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_acknowledged_by_user_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_period" ADD CONSTRAINT "settlement_period_franchisee_id_franchisee_id_fk" FOREIGN KEY ("franchisee_id") REFERENCES "public"."franchisee"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_period" ADD CONSTRAINT "settlement_period_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_period" ADD CONSTRAINT "settlement_period_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_commission_history" ADD CONSTRAINT "supplier_commission_history_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_commission_history" ADD CONSTRAINT "supplier_commission_history_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_link" ADD CONSTRAINT "upload_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploaded_file" ADD CONSTRAINT "uploaded_file_upload_link_id_upload_link_id_fk" FOREIGN KEY ("upload_link_id") REFERENCES "public"."upload_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_adjustment_settlement" ON "adjustment" USING btree ("settlement_period_id");--> statement-breakpoint
CREATE INDEX "idx_adjustment_type" ON "adjustment" USING btree ("adjustment_type");--> statement-breakpoint
CREATE INDEX "idx_adjustment_effective_date" ON "adjustment" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX "idx_brand_code" ON "brand" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_brand_is_active" ON "brand" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_commission_supplier" ON "commission" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "idx_commission_franchisee" ON "commission" USING btree ("franchisee_id");--> statement-breakpoint
CREATE INDEX "idx_commission_settlement" ON "commission" USING btree ("settlement_period_id");--> statement-breakpoint
CREATE INDEX "idx_commission_status" ON "commission" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_commission_period" ON "commission" USING btree ("period_start_date","period_end_date");--> statement-breakpoint
CREATE INDEX "idx_cross_ref_source" ON "cross_reference" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "idx_cross_ref_target" ON "cross_reference" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_cross_ref_code" ON "cross_reference" USING btree ("reference_code");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cross_ref_unique" ON "cross_reference" USING btree ("source_type","source_id","target_type","target_id","reference_type");--> statement-breakpoint
CREATE INDEX "idx_document_entity" ON "document" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_document_status" ON "document" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_document_type" ON "document" USING btree ("document_type");--> statement-breakpoint
CREATE INDEX "idx_document_expiration" ON "document" USING btree ("expiration_date");--> statement-breakpoint
CREATE INDEX "idx_email_log_template" ON "email_log" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "idx_email_log_status" ON "email_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_email_log_to_email" ON "email_log" USING btree ("to_email");--> statement-breakpoint
CREATE INDEX "idx_email_log_entity" ON "email_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_email_log_sent_at" ON "email_log" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "idx_email_log_created_at" ON "email_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_email_template_code" ON "email_template" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_email_template_category" ON "email_template" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_email_template_is_active" ON "email_template" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_franchisee_brand_id" ON "franchisee" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "idx_franchisee_code" ON "franchisee" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_franchisee_status" ON "franchisee" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_franchisee_is_active" ON "franchisee" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_franchisee_status_history_franchisee" ON "franchisee_status_history" USING btree ("franchisee_id");--> statement-breakpoint
CREATE INDEX "idx_franchisee_status_history_effective" ON "franchisee_status_history" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX "idx_franchisee_status_history_created" ON "franchisee_status_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_reminder_status" ON "reminder" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_reminder_due_date" ON "reminder" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "idx_reminder_remind_at" ON "reminder" USING btree ("remind_at");--> statement-breakpoint
CREATE INDEX "idx_reminder_assigned_to" ON "reminder" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "idx_reminder_entity" ON "reminder" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_settlement_franchisee" ON "settlement_period" USING btree ("franchisee_id");--> statement-breakpoint
CREATE INDEX "idx_settlement_status" ON "settlement_period" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_settlement_period_dates" ON "settlement_period" USING btree ("period_start_date","period_end_date");--> statement-breakpoint
CREATE INDEX "idx_settlement_due_date" ON "settlement_period" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "idx_supplier_code" ON "supplier" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_supplier_is_active" ON "supplier" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_supplier_commission_history_supplier" ON "supplier_commission_history" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "idx_supplier_commission_history_effective" ON "supplier_commission_history" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX "idx_supplier_commission_history_created" ON "supplier_commission_history" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_upload_link_token" ON "upload_link" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_upload_link_status" ON "upload_link" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_upload_link_entity" ON "upload_link" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_upload_link_expires_at" ON "upload_link" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_uploaded_file_upload_link" ON "uploaded_file" USING btree ("upload_link_id");--> statement-breakpoint
CREATE INDEX "idx_uploaded_file_created_at" ON "uploaded_file" USING btree ("created_at");