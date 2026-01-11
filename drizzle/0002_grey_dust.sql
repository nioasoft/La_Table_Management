CREATE TYPE "public"."user_role" AS ENUM('super_user', 'admin', 'franchisee_owner');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'suspended');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" "user_role";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "status" "user_status" NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "approved_at" timestamp;