-- Migration: Add settlement period types and enhanced status values
-- This migration adds:
-- 1. New settlement_period_type enum for period duration types
-- 2. Enhanced settlement_status enum with additional lifecycle states
-- 3. period_type column to settlement_period table

-- Create the settlement_period_type enum
DO $$ BEGIN
    CREATE TYPE "settlement_period_type" AS ENUM ('monthly', 'quarterly', 'semi_annual', 'annual');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add new status values to the settlement_status enum
-- First check if each value exists, then add if it doesn't
DO $$ BEGIN
    ALTER TYPE "settlement_status" ADD VALUE IF NOT EXISTS 'open';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE "settlement_status" ADD VALUE IF NOT EXISTS 'processing';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE "settlement_status" ADD VALUE IF NOT EXISTS 'pending_approval';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE "settlement_status" ADD VALUE IF NOT EXISTS 'invoiced';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add the period_type column to settlement_period table
ALTER TABLE "settlement_period" ADD COLUMN IF NOT EXISTS "period_type" "settlement_period_type" NOT NULL DEFAULT 'monthly';

-- Create index on period_type for better query performance
CREATE INDEX IF NOT EXISTS "idx_settlement_period_type" ON "settlement_period" ("period_type");
