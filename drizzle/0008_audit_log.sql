-- Create audit action enum
DO $$ BEGIN
    CREATE TYPE "public"."audit_action" AS ENUM(
        'create',
        'update',
        'delete',
        'approve',
        'reject',
        'status_change',
        'commission_change',
        'adjustment_create',
        'adjustment_update',
        'adjustment_delete',
        'settlement_approve',
        'settlement_status_change',
        'user_approve',
        'user_suspend',
        'user_reactivate',
        'permission_change'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create audit entity type enum
DO $$ BEGIN
    CREATE TYPE "public"."audit_entity_type" AS ENUM(
        'user',
        'supplier',
        'franchisee',
        'commission',
        'adjustment',
        'settlement_period',
        'brand',
        'document'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create audit_log table
CREATE TABLE IF NOT EXISTS "audit_log" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
    "user_name" text,
    "user_email" text,
    "timestamp" timestamp DEFAULT now() NOT NULL,
    "action" "audit_action" NOT NULL,
    "entity_type" "audit_entity_type" NOT NULL,
    "entity_id" text NOT NULL,
    "entity_name" text,
    "before_value" jsonb,
    "after_value" jsonb,
    "reason" text,
    "notes" text,
    "ip_address" text,
    "user_agent" text,
    "metadata" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- Create indexes for audit_log table
CREATE INDEX IF NOT EXISTS "idx_audit_log_user" ON "audit_log" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_audit_log_timestamp" ON "audit_log" USING btree ("timestamp");
CREATE INDEX IF NOT EXISTS "idx_audit_log_action" ON "audit_log" USING btree ("action");
CREATE INDEX IF NOT EXISTS "idx_audit_log_entity" ON "audit_log" USING btree ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "idx_audit_log_entity_type" ON "audit_log" USING btree ("entity_type");
CREATE INDEX IF NOT EXISTS "idx_audit_log_created_at" ON "audit_log" USING btree ("created_at");
