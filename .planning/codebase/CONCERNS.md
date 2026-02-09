# Codebase Concerns

**Analysis Date:** 2026-02-09

## Tech Debt

**Type Safety Bypass in Data Access Layer:**
- Issue: 138 instances of `as unknown as` and `as any` casts across data access functions
- Files: `src/data-access/*.ts` (e.g., `managementCompanies.ts`, `emailTemplates.ts`, `uploadLinks.ts`), `src/components/*.tsx`, `src/app/api/**/*.ts`
- Impact: Circumvents TypeScript strict mode, hiding potential type mismatches; difficult to refactor Drizzle ORM queries
- Fix approach: Migrate to explicit type returns with proper Drizzle query builders instead of casting the entire Promise result

**Unsafe Type Assertions in Error Handling:**
- Issue: 5+ instances of `(error as any)?.message?.includes()` checking for error types
- Files: `src/components/dashboard-widgets.tsx`, `src/components/period-status-widget.tsx`, `src/components/upload-status-widget.tsx`, `src/components/upcoming-reminders-widget.tsx`, `src/components/commission-settlement-widget.tsx`
- Impact: Error handling is fragile; doesn't catch all error types correctly
- Fix approach: Use typed error handlers or custom error classes with discriminated unions

**Weak Random Token Generation for File Uploads:**
- Issue: Math.random() used for generating unique identifiers instead of crypto-secure methods
- Files: `src/lib/storage.ts` (2 instances), `src/app/(protected)/admin/bkmvdata/page.tsx`
- Impact: Predictable tokens could allow unauthorized file upload access; security vulnerability for upload link tokens
- Fix approach: Use `crypto.randomBytes()` or `randomUUID()` (already imported in upload routes but not in storage.ts)

**Unimplemented Email Sending in Critical Paths:**
- Issue: Placeholder email sending logic with console.log instead of actual implementation
- Files: `src/app/api/reconciliation-v2/sessions/[sessionId]/reject-email/route.ts` (lines 60-67), `src/app/(protected)/admin/settlement-workflow/[periodKey]/files/page.tsx` (line 250-252)
- Impact: Users expect email notifications but receive none; discrepancies and file uploads don't notify stakeholders
- Fix approach: Integrate with existing `src/lib/email/service.ts` and `src/lib/email/webhook-service.ts` to send real emails

## Known Issues

**Upload Endpoint Not Implemented:**
- Symptoms: File upload dialog accepts files but doesn't persist them; returns simulated success
- Files: `src/app/(protected)/admin/settlement-workflow/[periodKey]/files/page.tsx` (line 250)
- Trigger: User attempts to upload supplier file in settlement workflow
- Workaround: Files upload successfully via public upload endpoint (`src/app/api/public/upload/[token]/route.ts`) but not via admin UI

**Database Migration Journal Out of Sync Risk:**
- Symptoms: Drizzle reports migrations as "applied successfully" even when schema changes aren't actually applied to database
- Files: `drizzle/meta/_journal.json` (39 migrations listed but not guaranteed synchronized)
- Trigger: Creating new migrations without running `npm run db:migrate`
- Workaround: Always verify columns exist after migrations with direct SQL queries

## Security Considerations

**Unsafe File Name Generation:**
- Risk: `Math.random()` used for file uniqueness; combined with timestamp predictability, could allow file collision attacks
- Files: `src/lib/storage.ts` (lines 32-33)
- Current mitigation: File names include entity name and period date to reduce collision likelihood
- Recommendations: Replace `Math.random()` with `crypto.getRandomValues()` or Node's `randomBytes()`

**Presigned URL Expiration Not Validated:**
- Risk: Upload links can expire but no real-time validation ensures they're actually checked
- Files: `src/data-access/uploadLinks.ts` (line 37-62 with validation logic), `src/app/api/public/upload/[token]/route.ts` (line 46-62)
- Current mitigation: `isUploadLinkValid()` checks expiration before accepting uploads
- Recommendations: Add server-side time sync validation and rate limiting on upload attempts

**CSV/Excel Injection Risk in Custom Parsers:**
- Risk: 28 custom supplier parsers parse untrusted Excel/CSV files without sanitizing values that become transaction descriptions/franchisee names
- Files: `src/lib/custom-parsers/*.ts` (e.g., `ale-ale-parser.ts`, `fandango-parser.ts`, `jumon-parser.ts`)
- Current mitigation: None visible - values extracted directly from files and stored in database
- Recommendations: Sanitize cell values, especially those containing formulas or special characters; validate numeric fields are actually numbers

**API Endpoint Authentication Pattern Inconsistency:**
- Risk: Some endpoints use `@/lib/api-middleware` (correct), others may miss auth checks
- Files: Multiple in `src/app/api/**/*.ts`; CLAUDE.md warns against using wrong auth imports
- Current mitigation: `isAuthError()` type guard prevents crashes, but missing checks aren't caught at compile time
- Recommendations: Create a lint rule or template to catch routes missing auth middleware

## Performance Bottlenecks

**Large Component Files with Complex State:**
- Problem: Page components exceed 2000 lines with multiple data fetches and state management
- Files: `src/app/(protected)/admin/bkmvdata/page.tsx` (2164 lines), `src/app/(protected)/admin/franchisees/page.tsx` (1812 lines), `src/app/(protected)/admin/suppliers/page.tsx` (1580 lines), `src/app/(protected)/admin/supplier-files/page.tsx` (1331 lines)
- Cause: Each page handles file uploads, filtering, table rendering, and dialogs without component extraction
- Improvement path: Break into smaller components (`FileUploadZone`, `FilterPanel`, `DataTable`); move business logic to server actions

**Recursive Franchisee Name Matching in Memory:**
- Problem: All franchisee aliases loaded into memory for fuzzy matching on every file parse
- Files: `src/lib/supplier-matcher.ts`, `src/data-access/franchisees.ts`, used in `src/app/api/public/upload/[token]/route.ts` (line 70+)
- Cause: No pagination or caching of matcher data; full table scans for each supplier
- Improvement path: Cache matcher data with TTL; use database full-text search for large datasets

**Unoptimized Promise.all in API Routes:**
- Problem: 15+ API routes use `Promise.all()` to fetch related data without cursor pagination
- Files: `src/app/api/dashboard/*.ts`, `src/app/api/commissions/*.ts`, `src/app/api/supplier-files/periods/[supplierId]/route.ts`
- Cause: Each request to dashboard or report fetches all related records without limits
- Improvement path: Add limit parameters to all queries; implement streaming responses for large datasets

**Drizzle ORM Type Casting Overhead:**
- Problem: 138+ `as unknown as Promise<Type[]>` casts cause unnecessary type inference work
- Files: All data access layers
- Cause: Drizzle's query return types aren't properly inferred
- Improvement path: Create typed query builder wrappers

## Fragile Areas

**Reconciliation V2 Module (Auto-Approval Threshold):**
- Files: `src/data-access/reconciliation-v2.ts`, `src/app/(protected)/admin/reconciliation-v2/page.tsx`
- Why fragile: Hardcoded ₪30 threshold (line 39) for auto-approving cross-reference matches; no UI to configure this per supplier or period
- Safe modification: Extract to database-managed configuration table before changing; add audit trail for threshold changes
- Test coverage: Only 4 test files exist; reconciliation logic has no dedicated tests

**Custom Parser Registry (28 Parsers, 28 Points of Failure):**
- Files: `src/lib/custom-parsers/` (28 different parser files), `src/lib/custom-parsers/index.ts` (registry)
- Why fragile: Each supplier requires hardcoded parser with fixed row extraction logic; if supplier changes Excel format, commission calculations silently break
- Safe modification: Add schema validation for expected columns before parsing; log warnings when columns don't match
- Test coverage: `src/scripts/test-custom-parsers.ts` exists but is not part of CI/CD; parsers aren't tested on real supplier files

**Settlement Workflow State Machine (Status Transitions):**
- Files: `src/db/schema.ts` (lines 80-91 with status enum), `src/data-access/settlements.ts`, `src/app/(protected)/admin/settlement-workflow/[periodKey]/page.tsx`
- Why fragile: Schema defines 8 statuses (open, processing, pending_approval, approved, completed, cancelled, pending, draft) but no enforcement of valid transitions
- Safe modification: Create explicit state machine with allowed transitions; add migration for old status values
- Test coverage: No state transition tests

**BKMVDATA Parser (Fixed-Width Format Parsing):**
- Files: `src/lib/bkmvdata-parser.ts` (1577 lines), uses in franchisee uploads
- Why fragile: Extracts data from fixed-width file positions (line 237: "positions 100-106" for reference); if format changes, data corruption occurs
- Safe modification: Add schema validation; extract position mapping to config; log warnings for malformed records
- Test coverage: Parser exists but no test files validate parsing results

**Database Migrations (39 Migrations):**
- Files: `drizzle/` directory with 39 sequential migration files
- Why fragile: Journal file (`_journal.json`) can fall out of sync; linear migration chain means earlier errors block later ones
- Safe modification: Always run `npm run db:migrate` and verify with direct SQL query before committing
- Test coverage: No migration tests; production-only verification

## Scaling Limits

**File Upload Storage (No Cleanup Policy):**
- Current capacity: Storage capacity is Vercel Blob or local filesystem - unbounded growth
- Limit: No automatic cleanup of old uploaded files; no retention policy defined
- Scaling path: Implement automatic deletion for files older than N months; add storage quota per franchisee/supplier

**Custom Parser Maintenance (Linear Growth):**
- Current capacity: 28 parsers maintained manually; each new supplier requires new code
- Limit: Adding 5+ new suppliers per quarter becomes unmaintainable
- Scaling path: Implement generic CSV/Excel parser with column mapping UI; only create custom parsers for truly complex formats

**Database Indexes for Large Tables:**
- Current capacity: No query performance metrics available; unknown if indexes exist on frequently-queried columns
- Limit: As franchisee/supplier/commission counts grow, queries may degrade
- Scaling path: Add database indexes on foreign keys and filter columns; implement query result pagination

**In-Memory Franchisee Matching (Fuzzy Matching):**
- Current capacity: All franchisee aliases loaded into memory; works for ~20 franchisees with ~5 aliases each
- Limit: Fails when adding 100+ franchisees or complex name variations
- Scaling path: Move matching to database full-text search or Postgres trigram similarity

## Dependencies at Risk

**Better Auth Framework Version Lock:**
- Risk: Project pins Better Auth to specific version; upgrade path unclear given tight integration
- Impact: Security patches may not be available without major refactoring
- Migration plan: Document upgrade steps; create integration test suite before upgrading

**XLSX Library for Excel Parsing:**
- Risk: Dependencies on `xlsx` and custom parsers for malformed Excel files
- Impact: Corrupted Excel files crash the parser; no graceful degradation
- Migration plan: Add try-catch with error categorization in all parsers

**Drizzle ORM Type Casting Pattern:**
- Risk: Heavy reliance on `as unknown as Type[]` pattern suggests version mismatch or usage antipattern
- Impact: Difficult to upgrade to new Drizzle versions
- Migration plan: Refactor type assertions to use proper Drizzle query builder types

## Test Coverage Gaps

**Reconciliation Logic (Untested):**
- What's not tested: Cross-reference creation, threshold matching, auto-approval logic, supplier vs franchisee amount comparison
- Files: `src/data-access/reconciliation-v2.ts`, `src/lib/bkmvdata-parser.ts`, `src/app/api/public/upload/[token]/route.ts`
- Risk: Discrepancies missed silently; wrong amounts approved
- Priority: High - financial accuracy depends on this

**Custom Parser Accuracy (Untested):**
- What's not tested: Each supplier's parser produces correct commission amounts; no regression tests
- Files: `src/lib/custom-parsers/*.ts` (28 files)
- Risk: Supplier format change → wrong commission calculations → undetected overpayments
- Priority: High - impacts invoices to 30+ suppliers

**Email System (Untested):**
- What's not tested: Email template rendering, Resend webhook handling, bounced/opened tracking
- Files: `src/lib/email/service.ts`, `src/lib/email/webhook-service.ts`, `src/app/api/webhooks/resend/route.ts`
- Risk: Suppliers never receive upload requests; no notification of issues
- Priority: High - core workflow depends on emails

**Settlement Workflow (Untested):**
- What's not tested: Status transitions, approval chains, manual adjustments
- Files: `src/app/(protected)/admin/settlement-workflow/[periodKey]/page.tsx`, `src/data-access/settlements.ts`
- Risk: Invalid state transitions allowed; adjustments not properly audited
- Priority: High - financial records depend on workflow integrity

**File Upload Validation (Untested):**
- What's not tested: File type validation, size limits, malware detection
- Files: `src/lib/file-validation.ts`, `src/lib/storage.ts`
- Risk: Malicious files uploaded; storage quota exceeded
- Priority: Medium - impacts security and availability

## Missing Critical Features

**No Upload Link Admin Management UI:**
- Problem: Upload links created only via API; no UI to view, revoke, or regenerate tokens
- Blocks: Support team can't troubleshoot upload issues
- Impact: Medium

**No Audit Trail Visualization:**
- Problem: Audit log written to database (`src/data-access/auditLog.ts`) but no UI to browse changes
- Blocks: Super users can't verify who changed what and when
- Impact: Medium - compliance risk

**No Settlement Approval Workflow UI:**
- Problem: Settlement workflow pages exist but approval chain not fully implemented
- Blocks: Can't approve settlements through UI; must use API
- Impact: High - blocks core workflow

**No Supplier Commission History Comparison:**
- Problem: Can't easily see how supplier commissions changed over time
- Blocks: Can't detect suspicious changes or trends
- Impact: Low - available via reports but not in detail view

---

*Concerns audit: 2026-02-09*
