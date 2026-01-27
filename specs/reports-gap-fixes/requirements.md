# Requirements: Reports System Gap Fixes

## Overview

Following a code review by 4 independent reviewers comparing the original implementation plan against the actual implementation, several gaps were identified that need to be addressed to complete the reports system.

## Background

The reports system was partially implemented with:
- Shared components (8/9 files completed)
- Reports hub at `/admin/reports`
- 4 of 5 planned reports (commissions, variance, unauthorized suppliers, deposits)
- Updated sidebar navigation and translations

## Gaps Identified

### Critical (Must Fix)

1. **Missing Invoice Report**
   - The plan specified `/admin/reports/invoice` but it was never created
   - Translation exists but is not used
   - Not linked in sidebar or reports hub

2. **Deposits Report Missing Supplier Dimension**
   - Plan specified "running balance per supplier-franchisee"
   - Current implementation only tracks by franchisee
   - Running balance is a simple sum, not chronological

### Medium Priority

3. **No Excel Export for New Reports**
   - Unauthorized suppliers report has no export
   - Deposits report has no export
   - Other reports have Excel/PDF export

4. **Old Paths Not Cleaned Up**
   - Old reports still exist at `/admin/commissions/*`
   - No redirects from old paths to new paths
   - Could cause user confusion

5. **No Caching for Filter Options**
   - Filter options (brands, franchisees, suppliers) fetched fresh every request
   - Plan specified using `unstable_cache`

### Low Priority

6. **Missing multi-select Component**
   - Listed in Phase 1 but not implemented
   - Not critical - single select works

7. **SQL Optimization**
   - `brandId` filtering done in JavaScript instead of SQL
   - Affects unauthorized suppliers and deposits reports

## Acceptance Criteria

### Invoice Report
- [ ] Page exists at `/admin/reports/invoice`
- [ ] Uses shared report components (ReportLayout, ReportDataTable)
- [ ] Linked in sidebar under "דוחות"
- [ ] Card appears in reports hub
- [ ] Supports filtering by date, brand, status
- [ ] Export to Excel works

### Deposits Report Improvements
- [ ] Shows deposits grouped by supplier (if data supports it)
- [ ] Running balance shows chronological accumulation
- [ ] Clear indication if supplier dimension not available in data

### Export Functionality
- [ ] Unauthorized suppliers report has Excel export
- [ ] Deposits report has Excel export

### Navigation Cleanup
- [ ] Redirects configured for old paths
- [ ] Old paths redirect to new locations with permanent redirects

### Performance
- [ ] Filter options cached for 5 minutes
- [ ] Reports load in under 2 seconds

## Dependencies

- Existing shared components at `src/components/reports/`
- Existing report utilities at `src/lib/report-utils.ts`
- Existing hooks at `src/hooks/use-report-*.ts`
- Authentication middleware at `src/lib/api-middleware.ts`

## Related Features

- Original reports implementation plan: `/Users/asafbenatia/.claude/plans/polished-jumping-hejlsberg.md`
- Existing invoice report (old location): `/admin/commissions/invoice`
