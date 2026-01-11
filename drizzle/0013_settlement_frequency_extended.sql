-- Migration: Add semi_annual and annual options to settlement_frequency enum
-- This migration adds new frequency options for suppliers who settle less frequently

-- Add semi_annual value to settlement_frequency enum
DO $$ BEGIN
    ALTER TYPE "settlement_frequency" ADD VALUE IF NOT EXISTS 'semi_annual';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add annual value to settlement_frequency enum
DO $$ BEGIN
    ALTER TYPE "settlement_frequency" ADD VALUE IF NOT EXISTS 'annual';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
