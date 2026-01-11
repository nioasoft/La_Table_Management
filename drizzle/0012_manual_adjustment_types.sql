-- Add new adjustment types for manual discrepancy handling
-- These types are used for manually adjusting discrepancies between supplier and franchisee records

-- Add new values to the adjustment_type enum
ALTER TYPE adjustment_type ADD VALUE IF NOT EXISTS 'deposit';
ALTER TYPE adjustment_type ADD VALUE IF NOT EXISTS 'supplier_error';
ALTER TYPE adjustment_type ADD VALUE IF NOT EXISTS 'timing';
ALTER TYPE adjustment_type ADD VALUE IF NOT EXISTS 'other';
