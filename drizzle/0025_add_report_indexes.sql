-- Migration: Add performance indexes for commission report queries
-- These composite indexes optimize common query patterns in the reports

-- Index for supplier + period queries (e.g., filtering commissions by supplier within a date range)
-- Supports: getCommissionsWithDetails, getCommissionSummaryBySupplier, supplier file processing
CREATE INDEX IF NOT EXISTS "idx_commission_supplier_period" ON "commission" USING btree ("supplier_id", "period_start_date");

-- Index for franchisee + status queries (e.g., active commission tracking per franchisee)
-- Supports: franchisee detail views, status-based reporting
CREATE INDEX IF NOT EXISTS "idx_commission_franchisee_status" ON "commission" USING btree ("franchisee_id", "status");

-- Index for status + period queries (e.g., finding pending commissions in a date range)
-- Supports: commission workflow, status filtering with period constraints
CREATE INDEX IF NOT EXISTS "idx_commission_status_period" ON "commission" USING btree ("status", "period_start_date");

-- Index for brand-based filtering via franchisee join (supports brand report queries)
-- The franchisee table already has idx_franchisee_brand_id, but adding a composite
-- index with isActive improves queries that filter by brand and active franchisees
CREATE INDEX IF NOT EXISTS "idx_franchisee_brand_active" ON "franchisee" USING btree ("brand_id", "is_active");
