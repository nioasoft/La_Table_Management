# Architecture

**Analysis Date:** 2026-02-09

## Pattern Overview

**Overall:** Layered N-tier architecture with clear separation of concerns: API routes → business logic → data access → database.

**Key Characteristics:**
- **Server-first approach**: React Server Components by default, client-side only where interaction needed
- **Type-safe database access**: Drizzle ORM with TypeScript inference from schema
- **API-driven data fetching**: TanStack Query for client-side state management
- **Centralized authentication**: Better Auth with granular role-based access control (super_user, admin, franchisee_owner)
- **Comprehensive audit trail**: All entity mutations logged with before/after values
- **Domain-focused organization**: Data access layer grouped by business domain (suppliers, commissions, settlements, etc.)

## Layers

**Presentation Layer:**
- Purpose: React components for user interface
- Location: `src/app/` (pages), `src/components/` (reusable components)
- Contains: Next.js pages with Server Components, client components for interactive UI, shadcn/ui base components
- Depends on: Queries layer (via TanStack Query), auth-client for session
- Used by: Browser clients via HTTP

**API Layer:**
- Purpose: RESTful endpoints for client communication and backend operations
- Location: `src/app/api/`
- Contains: Route handlers with authentication middleware, request validation, response formatting
- Depends on: Data-access layer, lib utilities, auth middleware
- Used by: Client-side components via fetch, external systems via webhooks

**Business Logic Layer:**
- Purpose: Core domain logic for commission calculations, file processing, reconciliation
- Location: `src/lib/` - file-processor.ts, franchisee-matcher.ts, supplier-matcher.ts, settlement-periods.ts, report-utils.ts
- Contains: Algorithm implementations (VAT calculations, commission formulas), file parsing logic, data transformations
- Depends on: Database schema definitions, error handling utilities
- Used by: Data-access layer, API routes

**Data-Access Layer:**
- Purpose: Centralized database queries using Drizzle ORM
- Location: `src/data-access/` - 34 domain-specific modules
- Contains: Type-safe query functions, audit logging integration, result transformation
- Depends on: Database driver, Drizzle ORM, schema definitions
- Used by: API routes, queries (React Query), scripts

**Database Layer:**
- Purpose: PostgreSQL persistence with Drizzle schema
- Location: `src/db/` - index.ts (connection pool), schema.ts (27+ tables)
- Contains: Connection pooling (Neon PostgreSQL), schema definitions with Drizzle, enum types
- Depends on: pg driver, connection configuration from environment
- Used by: Data-access layer exclusively

**Authentication Layer:**
- Purpose: Session management and authorization
- Location: `src/utils/auth.ts` (Better Auth configuration), `src/lib/api-middleware.ts` (API route helpers)
- Contains: Auth configuration (email/password, Google OAuth), user session extensions (role, status), permission logic
- Depends on: Database (user/session tables via drizzle adapter)
- Used by: Protected layouts, API routes, client auth context

## Data Flow

**Commission Calculation Workflow:**

1. Supplier uploads Excel file → presigned URL to S3/R2
2. API route receives file upload notification
3. File processing service (`src/lib/file-processor.ts`) parses Excel:
   - Reads supplier file mapping configuration
   - Extracts franchisee names (fuzzy-matched via `src/lib/franchisee-matcher.ts`)
   - Parses amounts, dates, validates data
   - Calculates commission: `netAmount × commissionRate`
   - Applies VAT adjustment if needed (configurable per supplier)
4. Results stored via `src/data-access/supplier-file-uploads.ts`
5. Commission records created via `src/data-access/commissions.ts`
6. Cross-reference matching compares supplier vs franchisee reported amounts (≤₪10 = matched)
7. Discrepancies reported to `src/data-access/crossReferences.ts`
8. Settlement period aggregates commissions, groups by brand/management company
9. Invoice reports generated via `src/lib/report-utils.ts`

**State Management:**

- **Server-side state**: All persistent data in PostgreSQL (authoritative)
- **Client-side state**: TanStack Query caches API responses with automatic invalidation
- **Session state**: Better Auth manages user authentication, extended with role/status in callbacks
- **UI state**: React hooks for local component state (form inputs, modal open/close, filters)

## Key Abstractions

**SupplierFileMapping:**
- Purpose: Configurable file parsing rules per supplier (column names, date formats, decimal separators)
- Examples: `src/data-access/supplier-file-uploads.ts`, `src/lib/custom-parsers/`
- Pattern: Strategy pattern - each supplier can have custom parsing logic

**Commission:**
- Purpose: Represents a supplier's commission for a specific franchisee in a period
- Examples: `src/data-access/commissions.ts`, `src/app/api/commissions/*`
- Pattern: Value object with calculated fields (commission amount based on supplier rate)

**CrossReference:**
- Purpose: Reconciliation comparison between supplier-reported and franchisee-reported amounts
- Examples: `src/data-access/crossReferences.ts`, `src/app/api/reconciliation/*`
- Pattern: State machine with resolution workflow (open → matched/discrepancy → approved)

**Settlement:**
- Purpose: Aggregation of commissions for a specific period with approval workflow
- Examples: `src/data-access/settlements.ts`, `src/lib/settlement-periods.ts`
- Pattern: Aggregate root with status workflow (open → processing → pending_approval → approved → invoiced)

**Audit Log:**
- Purpose: Comprehensive change tracking with before/after values
- Examples: `src/data-access/auditLog.ts`
- Pattern: Observer pattern - automatic logging on entity mutations

## Entry Points

**Web Application:**
- Location: `src/app/layout.tsx` (root), `src/app/(protected)/layout.tsx` (authenticated)
- Triggers: HTTP request to www.latable.co.il
- Responsibilities: Theme provider setup, authentication check, sidebar layout, session validation

**API Endpoints:**
- Location: `src/app/api/**` (64+ routes organized by domain)
- Triggers: Client fetch requests from React components
- Responsibilities: Authentication check, permission validation, data transformation, HTTP response

**Background Jobs (Future):**
- Location: `src/scripts/` - ad-hoc data migration and testing scripts
- Triggers: Manual CLI execution with `tsx` runner
- Responsibilities: Data imports, bulk updates, testing file processors

## Error Handling

**Strategy:** Centralized error categorization with severity levels and rich context.

**Patterns:**

- **File Processing Errors** (`src/lib/file-processing-errors.ts`): Categorized errors (missing_columns, invalid_data, unmatched_franchisee, etc.) with row/column context for user debugging
- **API Route Errors**: Middleware returns NextResponse with standard JSON format `{error, code, status}`
- **Database Errors** (`src/lib/drizzle-errors.ts`): Wrapped to catch constraint violations, handle race conditions
- **Validation Errors**: Zod schema validation in form submissions and API inputs
- **User-facing messages**: Toast notifications via `sonner`, Hebrew error messages from constants

## Cross-Cutting Concerns

**Logging:**
- Console logging in development (Drizzle logger enabled)
- Audit trail stored in database via `src/data-access/auditLog.ts`
- File processing errors collected in `processingResult.errors` (JSON field)
- Email logs tracked in `email_log` table

**Validation:**
- **Input validation**: Zod schemas for form inputs and API request bodies
- **Data validation**: File processor validates amounts, dates, required columns
- **Business rule validation**: Cross-reference matching logic enforces ≤₪10 tolerance

**Authentication:**
- Better Auth session in cookies (httpOnly, secure)
- API routes check session via `@/lib/api-middleware` (never direct imports)
- Role-based authorization: super_user, admin, franchisee_owner
- Protected layout enforces user status checks (pending → approval page, suspended → sign-out)

**Permissions:**
- Module-level granularity: view, edit, create, delete, approve per module (10 modules)
- Enforced at API route level via `requireAdminOrSuperUser()` and `requireRole()`
- Stored in user record (permissions JSONB field)

**RTL Support:**
- HTML root: `dir="rtl" lang="he"`
- Tailwind CSS: Logical properties (ps-4 not pl-4, me-2 not mr-2)
- Components: RTL-aware positioning for dropdowns, toasts, sidebars
- Font: Assistant Hebrew subset for proper typography

---

*Architecture analysis: 2026-02-09*
