# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

La Table Management is a commission management system for a restaurant franchise group (~20 franchisees across 3 brands, ~30 suppliers). It automates the quarterly commission workflow: requesting reports, cross-referencing data, handling discrepancies, and generating invoices.

### Tech Stack

- **Framework**: Next.js 15 with App Router and React 19
- **Language**: TypeScript with strict mode
- **Database**: PostgreSQL (Neon) with Drizzle ORM
- **Authentication**: Better Auth with email/password
- **Styling**: Tailwind CSS with shadcn/ui components
- **File Storage**: AWS S3/R2 with presigned URL uploads
- **Email**: Resend + React Email for automated communications
- **State**: TanStack Query for server state, React Server Components by default
- **Language/RTL**: Hebrew (default), RTL layout throughout

### Project Structure

```
src/
├── app/            # Next.js App Router pages, layouts, API routes
├── components/     # React components (ui/ for base shadcn components)
├── data-access/    # Data access layer (DB queries, business logic)
├── db/             # Database config and Drizzle schema
├── emails/         # React Email templates
├── hooks/          # Custom React hooks
├── lib/            # Shared utilities, parsers, services
├── queries/        # TanStack Query definitions
├── scripts/        # One-off scripts (imports, migrations)
├── styles/         # Global CSS
└── utils/          # Small utility functions
```

### Business Domain

**Core Workflow:**
1. Request reports from suppliers/franchisees via automated emails
2. Collect Excel files via secure upload links
3. Cross-reference supplier vs franchisee amounts (≤₪30 threshold = matched)
4. Handle discrepancies with adjustments
5. Calculate commissions per supplier, group by brand
6. Generate invoice reports per management company

**Key Concepts:**
- **Supplier** - Vendor paying commissions (fixed % or per-item rate)
- **Franchisee** - Restaurant with aliases (different suppliers use different names)
- **Settlement Period** - Monthly/quarterly/semi-annual/annual reconciliation cycle
- **Cross-Reference** - Comparison finding discrepancies between reported amounts

**User Roles:**
- `super_user` - Full access, approves users and settlements
- `admin` - Configurable view/edit per module
- `franchisee_owner` - Limited access to own data

### Database Schema

27+ tables organized by domain:

**Core Entities:** `brands` (Pat Vini, Mina Tomai, King Kong), `suppliers`, `franchisees`, `management_companies` (Panikon, Pedvili, Ventami)

**Financial:** `commissions`, `settlements`, `adjustments`, `cross_references`

**Communication:** `email_templates`, `email_logs`, `file_requests`, `upload_links`, `uploaded_files`

**Audit:** `audit_log`, `supplier_commission_history`, `franchisee_status_history`

## Key Patterns & Conventions

### Settlement Workflow State Machine
```
open → processing → pending_approval → approved → invoiced
```
`transitionSettlementStatus()` in `src/data-access/settlements.ts` is the central orchestrator. The API routes layer (`src/app/api/`) acts as the orchestration hub connecting settlements → reconciliation → commissions → cross-references → invoice PDFs.

### Reconciliation
Always use **reconciliation-v2** (`src/data-access/reconciliation-v2.ts`), NOT v1. Threshold: ₪30 (`RECONCILIATION_THRESHOLD`). BKMV parsing: `src/lib/bkmvdata-parser.ts`.

### API Route Authentication

**IMPORTANT**: Always use `@/lib/api-middleware`, NOT direct auth imports.

```typescript
// Correct
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  // ...
}
```

Available: `requireAuth`, `requireAdminOrSuperUser`, `requireSuperUser`

### RTL/Hebrew

- `dir="rtl"` and `lang="he"` on root layout
- Rubik font with Hebrew subset
- RTL-aware Tailwind utilities
- **Radix/shadcn gotcha**: always pass `dir="rtl"` to Tabs, Dialog, etc. — they default to `ltr`

### Date Formatting (Important!)

**Never use `toISOString()` for user-facing dates!** It converts to UTC, shifting dates by timezone offset (Israel is UTC+2/3). October 1st becomes September 30th.

```typescript
const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
```

### Other Patterns
- **Type Safety**: Full TypeScript with Drizzle ORM schema inference, UUIDs for PKs
- **File Uploads**: Presigned URLs for direct S3/R2 uploads
- **Fuzzy Matching**: Franchisee name matching using aliases for supplier file parsing
- **Granular Permissions**: Module-level (view/edit/create/delete/approve) × 10 modules
- **Audit Trail**: Comprehensive logging of all entity changes with before/after values

## Database Environment

**IMPORTANT: Always work with the PRODUCTION database only.**

- **Production URL**: `www.latable.co.il`
- **Production Database**: Neon PostgreSQL (connection string in `.env` as `DATABASE_URL`)
- **Do NOT use** the local Docker database for data operations

```bash
# Direct production access
PGPASSWORD=<password> psql "postgresql://neondb_owner@ep-withered-sunset-ag7zdsgi-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require"
```

## Development

### Commands

```bash
npm run dev                 # Dev server on port 3000 (Turbopack)
npm run build              # Production build (includes type checking)
npm run lint               # ESLint

npm run db:migrate         # Run migrations on production
npm run db:generate        # Generate new migration files
npm run db:studio          # Drizzle Studio

npm run test:e2e           # Playwright E2E tests
```

### Environment Setup

1. Copy `.env.example` to `.env` and configure: Database (Neon), Better Auth secrets, AWS S3/R2, Resend API key, `NEXT_PUBLIC_` variables
2. Run `npm run db:migrate`

## Knowledge Graph (graphify)

A pre-built knowledge graph of `src/` lives in `graphify-out/graph.json` (1,788 nodes, 2,974 edges, 43 communities).

**Before reading multiple source files to answer architecture/flow questions**, query the graph first:
```
/graphify query "<question>"
```

**27x cheaper** on average (~22K tokens vs ~600K). Use for: tracing flows, understanding dependencies, finding connections. Still read source for: writing code, debugging, reviewing implementations.

**After significant code changes**: `/graphify src --update`

## Additional Information

- **PRD** - `docs/PRD.md`
- **Meeting Notes** - `docs/reut_meeting.md`
- **Authentication** - `docs/authentication.md`
- **Architecture** - `docs/architecture.md`
- **UX** - `docs/ux.md`
- **File Uploads** - `docs/file-uploads.md`
- **Suppliers Reference** - `docs/suppliers-reference.md`

## Test User Notes

- Dedicated test user for QA. Can be temporarily promoted to `admin` during testing.
- After testing, must be demoted back (role unset, status not active).
