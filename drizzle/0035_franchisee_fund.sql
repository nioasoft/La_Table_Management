-- Add franchisee fund fields to supplier table
-- When enabled, a portion of the commission is allocated to a franchisee fund
-- Example: 12% total commission = 10% regular + 2% fund

ALTER TABLE "supplier" ADD COLUMN "franchisee_fund_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "supplier" ADD COLUMN "franchisee_fund_percentage" decimal(5,2);
