# Codebase Structure

**Analysis Date:** 2026-02-09

## Directory Layout

```
src/
├── app/                          # Next.js App Router pages and layouts
│   ├── (protected)/              # Authenticated routes with session check
│   │   ├── admin/                # Admin dashboard pages (settlement, suppliers, commissions, etc.)
│   │   └── layout.tsx            # Protected layout with sidebar, auth check, query/theme providers
│   ├── api/                      # RESTful API endpoints
│   │   ├── supplier-files/       # File upload and review endpoints
│   │   ├── commissions/          # Commission CRUD endpoints
│   │   ├── reconciliation/       # Cross-reference matching endpoints
│   │   └── [other domains]/      # Settlement, franchisee, brand, user APIs
│   ├── layout.tsx                # Root layout with HTML dir="rtl", fonts, theme
│   ├── sign-in/page.tsx          # Authentication page
│   └── [public pages]/           # Landing pages (about, etc.)
│
├── components/                   # Reusable React components
│   ├── ui/                       # Base shadcn/ui components (button, input, dialog, etc.)
│   ├── admin/                    # Admin-specific components (tabs, config editors)
│   ├── sidebar/                  # Navigation sidebar with role-based menu
│   ├── supplier-files/           # File upload, review, status components
│   ├── settlements/              # Settlement workflow components
│   ├── reconciliation-v2/        # Reconciliation UI components
│   ├── reports/                  # Report display and export components
│   └── [domain-specific]/        # Commission, franchisee, supplier detail cards
│
├── data-access/                  # Database query functions (34 modules)
│   ├── suppliers.ts              # Supplier CRUD and queries
│   ├── franchisees.ts            # Franchisee CRUD and matching
│   ├── commissions.ts            # Commission queries and aggregations
│   ├── settlements.ts            # Settlement period management
│   ├── crossReferences.ts        # Discrepancy matching and resolution
│   ├── supplier-file-uploads.ts  # File upload tracking and processing
│   ├── adjustments.ts            # Manual adjustment records
│   ├── auditLog.ts               # Change tracking with before/after
│   ├── brands.ts                 # Brand management
│   ├── reconciliation-v2.ts      # Reconciliation session state
│   ├── deposits.ts               # Deposit records
│   ├── emailTemplates.ts         # Email template management
│   ├── [other domains].ts        # (33 more domain modules)
│
├── queries/                      # TanStack Query (react-query) hooks
│   ├── suppliers.ts              # useSuppliers, useSupplier hooks
│   ├── commissions.ts            # Commission fetch hooks
│   ├── supplier-file-uploads.ts  # File upload status hooks
│   ├── reconciliation-v2.ts      # Reconciliation query hooks
│   └── [other domains].ts        # Domain-specific hooks
│
├── lib/                          # Business logic and utilities (26 modules)
│   ├── api-middleware.ts         # Auth middleware for API routes (requireAdminOrSuperUser, etc.)
│   ├── auth-client.ts            # Client-side auth context (Better Auth)
│   ├── file-processor.ts         # Excel parsing, VAT calculations, commission math
│   ├── file-processing-errors.ts # Error categorization and severity system
│   ├── file-validation.ts        # File type and size validation
│   ├── franchisee-matcher.ts     # Fuzzy name matching for franchisee reconciliation
│   ├── supplier-matcher.ts       # Supplier file column name parsing
│   ├── bkmvdata-parser.ts        # BKMV accounting file parsing (52KB)
│   ├── settlement-periods.ts     # Period calculation, status workflow
│   ├── report-utils.ts           # Commission and revenue report generation
│   ├── date-utils.ts             # formatLocalDate (CRITICAL: no toISOString)
│   ├── pagination.ts             # Cursor-based pagination utilities
│   ├── permissions.ts            # Module-level permission checking
│   ├── rate-limit.ts             # API rate limiting
│   ├── storage.ts                # S3/R2 presigned URL generation
│   ├── drizzle-errors.ts         # Database error handling
│   ├── query-client.tsx          # TanStack Query client setup
│   ├── custom-parsers/           # Supplier-specific file parsers (32 subdirs)
│   ├── email/                    # Email sending utilities
│   ├── notifications/            # Notification system
│   ├── translations/             # Hebrew/RTL translation constants
│   ├── validations/              # Zod schemas for validation
│   └── utils.ts                  # Utility functions (cn, constants)
│
├── db/                           # Database configuration
│   ├── index.ts                  # Drizzle instance with pg Pool
│   └── schema.ts                 # 27+ table definitions with enums (830+ lines)
│
├── hooks/                        # Custom React hooks
│   ├── use-admin-auth.ts         # Ensure admin/super_user role
│   ├── use-sidebar-state.ts      # Sidebar collapse state
│   ├── use-report-filters.ts     # Report filter state
│   └── use-report-pagination.ts  # Report pagination state
│
├── utils/                        # Minimal utilities directory
│   └── auth.ts                   # Better Auth configuration (OAuth, email/password)
│
├── emails/                       # React Email templates (Resend)
│   ├── file-request.tsx          # Request file submission email
│   ├── supplier-request.tsx      # Request supplier report email
│   ├── franchisee-request.tsx    # Request franchisee confirmation email
│   ├── reminder.tsx              # Reminder email template
│   ├── upload-notification.tsx   # File upload confirmation
│   ├── custom.tsx                # Custom message emails
│   └── components/               # Email component building blocks
│
├── types/                        # TypeScript type definitions
│   └── reconciliation-v2.ts      # Domain types for reconciliation
│
├── scripts/                      # Standalone scripts (data migration, testing)
│   ├── import-suppliers.ts       # Supplier data import
│   ├── import-franchisees.ts     # Franchisee data import
│   ├── test-file-processing.ts   # File processor testing
│   ├── test-custom-parsers.ts    # Custom parser testing
│   └── [other scripts]/          # Bulk updates, data fixes
│
├── styles/                       # Global CSS
│   └── globals.css               # Tailwind directives
│
├── proxy.ts                      # API proxy utilities (edge function helpers)
└── __tests__/                    # Unit and integration tests

docs/                             # Documentation (outside src/)
├── PRD.md                        # Product requirements and database schema
├── CLAUDE.md                     # Architecture and tech stack guide
├── authentication.md             # Better Auth setup details
├── file-uploads.md               # S3/R2 presigned URL flow
├── suppliers-reference.md        # Supplier configs and file mappings
└── [other docs]/
```

## Directory Purposes

**`src/app/`:**
- Purpose: Next.js routing and page components
- Contains: Server Components (default), client components with "use client" directive
- Key files: Root layout with RTL setup, protected layout with auth, 40+ admin pages

**`src/app/api/`:**
- Purpose: RESTful endpoints for client requests
- Contains: 64+ route handlers with authentication middleware
- Organization: Grouped by domain (supplier-files, commissions, reconciliation, etc.)

**`src/components/`:**
- Purpose: Reusable React UI components
- Contains: shadcn/ui base components, domain-specific components, layouts
- Key pattern: Props-based configuration, minimal local state, data via parent/queries

**`src/data-access/`:**
- Purpose: Drizzle ORM query functions with audit logging
- Contains: Type-safe database operations, result transformation
- Pattern: One module per domain entity, exports utility functions and TypeScript types

**`src/queries/`:**
- Purpose: TanStack Query hooks for client-side data fetching
- Contains: Query key factories, useQuery and useMutation wrappers
- Pattern: Mirrors API endpoints, handles caching and invalidation

**`src/lib/`:**
- Purpose: Core business logic and utilities
- Key modules:
  - `file-processor.ts` - Excel parsing, VAT, commission calculations (21KB)
  - `franchisee-matcher.ts` - Fuzzy name matching (17KB)
  - `settlement-periods.ts` - Period calculations and workflow (17KB)
  - `bkmvdata-parser.ts` - BKMV accounting format (52KB)
  - `custom-parsers/` - 32 supplier-specific file parsers

**`src/db/`:**
- Purpose: Database configuration and schema
- Contains: Drizzle ORM instance with pg connection pool, 27+ table definitions with relations

**`src/utils/`:**
- Purpose: Minimal - only Better Auth configuration
- Note: Most utilities live in `src/lib/` instead

**`src/emails/`:**
- Purpose: React Email templates for automated communications
- Contains: Email components using react-email, rendered by Resend
- Pattern: Structured emails for file requests, reminders, notifications

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx` - Root with RTL, fonts, metadata
- `src/app/(protected)/layout.tsx` - Auth check, sidebar, query/theme providers
- `src/app/(protected)/admin/page.tsx` - Admin dashboard redirect
- `src/utils/auth.ts` - Better Auth configuration entry point

**API Routes:**
- `src/app/api/suppliers/route.ts` - Supplier list/create
- `src/app/api/suppliers/[id]/route.ts` - Supplier detail/update
- `src/app/api/supplier-files/review/route.ts` - Files needing review
- `src/app/api/commissions/route.ts` - Commission queries
- `src/app/api/reconciliation/route.ts` - Cross-reference operations

**Core Logic:**
- `src/lib/file-processor.ts` - Commission calculation, VAT handling
- `src/lib/franchisee-matcher.ts` - Fuzzy name matching algorithm
- `src/lib/supplier-matcher.ts` - File column mapping
- `src/lib/settlement-periods.ts` - Period calculations
- `src/lib/report-utils.ts` - Revenue and commission report generation

**Data Access:**
- `src/data-access/suppliers.ts` - Supplier CRUD
- `src/data-access/franchisees.ts` - Franchisee operations
- `src/data-access/commissions.ts` - Commission queries and aggregations
- `src/data-access/settlements.ts` - Settlement management
- `src/data-access/crossReferences.ts` - Discrepancy tracking

**Database:**
- `src/db/schema.ts` - All table definitions (27+ tables)
- `src/db/index.ts` - Drizzle instance with pg Pool

**Testing:**
- `src/__tests__/` - Jest/Vitest test files
- `tests/` - Playwright E2E tests

## Naming Conventions

**Files:**
- `camelCase.ts` - Most files in lib, utils, hooks
- `PascalCase.tsx` - React components (automatic convention)
- `kebab-case.ts` - Some data-access modules (suppliers.ts, franchisees.ts, etc.)
- `-v2` suffix - New versions of modules (reconciliation-v2.ts, settlement-v2.ts)

**Directories:**
- `kebab-case/` - Most directories follow kebab-case (supplier-files, data-access, custom-parsers)
- `PascalCase/` - Component directories rarely use this

**Functions:**
- `camelCase()` - All function exports
- `UPPER_SNAKE_CASE` - Constants (ISRAEL_VAT_RATE, ERROR_CODES)
- `use*()` - React hooks (useSuppliers, useAdminAuth)
- `require*()` - Middleware functions (requireAdminOrSuperUser, requireAuth)
- `get*()` - Data access query functions (getSuppliers, getSupplierById)

**Types:**
- `PascalCase` - All TypeScript types and interfaces
- `*Result` suffix - Result types (FileProcessingResult)
- `*Error` suffix - Error types (FileProcessingError)
- `*WithDetails` suffix - Extended types (SupplierFileUploadWithDetails)

## Where to Add New Code

**New Feature (e.g., new report type):**
- API route: `src/app/api/reports/[type]/route.ts`
- Data access: `src/data-access/reports.ts` (or extend existing)
- Query hook: `src/queries/reports.ts` (or extend)
- Component: `src/components/reports/[ReportName].tsx`
- Tests: `src/__tests__/reports.test.ts`
- Business logic: `src/lib/report-utils.ts` (or new file if complex)

**New Component/Module (e.g., new franchisee feature):**
- Implementation: `src/components/franchisee-[feature-name].tsx`
- Page: `src/app/(protected)/admin/franchisees/[feature]/page.tsx`
- Data layer: Extend `src/data-access/franchisees.ts`

**Utilities:**
- Shared helpers: `src/lib/[domain]-utils.ts` (not src/utils/)
- Business logic: `src/lib/[domain]-[algorithm].ts`
- Validation schemas: `src/lib/validations/[domain].ts`
- Constants: `src/lib/[domain]-constants.ts` or inline

**Custom File Parsers:**
- New supplier parser: `src/lib/custom-parsers/[supplier-code]/parser.ts`
- Pattern: Export `parse()` function and config

## Special Directories

**`src/lib/custom-parsers/`:**
- Purpose: Supplier-specific file format handlers
- Generated: No (hand-written per supplier)
- Committed: Yes
- Contains: 32 subdirectories, one parser per supplier (Avrahami, Mana Tami, etc.)

**`src/scripts/`:**
- Purpose: One-off data operations and testing
- Generated: No
- Committed: Yes (but don't run in production without review)
- Pattern: Standalone scripts using tsx runner

**`src/emails/`:**
- Purpose: React Email templates rendered by Resend
- Generated: No
- Committed: Yes
- Pattern: Export React components, no TypeScript errors

**`.next/`:**
- Purpose: Build output from Next.js
- Generated: Yes (during build)
- Committed: No (in .gitignore)

**`drizzle/`:**
- Purpose: Database migrations and seed scripts
- Generated: Yes (via `npm run db:generate`)
- Committed: Yes (important for schema versioning)
- Pattern: Migration files auto-created by drizzle-kit

---

*Structure analysis: 2026-02-09*
