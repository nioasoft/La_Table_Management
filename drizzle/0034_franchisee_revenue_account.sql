-- Add revenue account code to franchisee for auto-matching BKMVDATA revenue accounts
ALTER TABLE franchisee ADD COLUMN revenue_account_code TEXT;

-- Add comment for documentation
COMMENT ON COLUMN franchisee.revenue_account_code IS 'Revenue account code from BKMVDATA - for auto-matching revenue accounts in future uploads';
