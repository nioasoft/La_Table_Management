-- Add permissions JSONB column to user table for module-level granular permissions
ALTER TABLE "user" ADD COLUMN "permissions" jsonb;--> statement-breakpoint

-- Add index for better query performance on permissions
CREATE INDEX "idx_user_permissions" ON "user" USING gin ("permissions");
