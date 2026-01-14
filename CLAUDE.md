# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

La Table Management is a commission management system for a restaurant franchise group (~20 franchisees across 3 brands, ~30 suppliers). It automates the quarterly commission workflow: requesting reports, cross-referencing data, handling discrepancies, and generating invoices.

### Tech Stack

- **Framework**: Next.js 15 with App Router and React 19
- **Language**: TypeScript with strict mode
- **Database**: PostgreSQL with Drizzle ORM for type-safe queries
- **Authentication**: Better Auth with email/password authentication
- **Styling**: Tailwind CSS with shadcn/ui components
- **File Storage**: AWS S3/R2 with presigned URL uploads
- **Email**: Resend + React Email for automated communications
- **Internationalization**: RTL support for Hebrew language (default)

### Project Structure

- `src/app/` - Next.js App Router pages and layouts
- `src/components/` - Reusable React components with `ui/` subfolder for base components
- `src/db/` - Database configuration and schema definitions
- `src/data-access/` - Data access layer functions
- `src/fn/` - Business logic functions and middleware
- `src/hooks/` - Custom React hooks for data fetching and state management
- `src/queries/` - TanStack Query definitions for server state
- `src/utils/` - Utility functions and helpers
- `src/config/` - Environment and application configuration
- `src/lib/` - Shared libraries and utilities
- `src/styles/` - Global CSS and Tailwind configuration

### Business Domain

**Core Workflow:**
1. Request reports from suppliers/franchisees via automated emails
2. Collect Excel files via secure upload links
3. Cross-reference supplier vs franchisee amounts (≤₪10 = matched)
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

**Core Entities:**
- `brands` - Pat Vini, Mina Tomai, King Kong
- `suppliers` - Vendors with commission rates and file mapping configs
- `franchisees` - Restaurant locations with aliases for name matching
- `management_companies` - Invoice-issuing entities (Panikon, Pedvili, Ventami)

**Financial:**
- `commissions` - Commission records per supplier/franchisee/period
- `settlements` - Settlement periods with status workflow
- `adjustments` - Manual corrections (credit, deposit, timing, errors)
- `cross_references` - Supplier vs franchisee amount comparisons

**Communication:**
- `email_templates`, `email_logs`, `file_requests`, `upload_links`, `uploaded_files`

**Audit:**
- `audit_log`, `supplier_commission_history`, `franchisee_status_history`

### Key Patterns

- **Data Fetching**: React Server Components with TanStack Query for client-side state
- **Authentication**: Better Auth with session management
- **File Uploads**: Presigned URLs for direct S3/R2 uploads
- **Type Safety**: Full TypeScript with Drizzle ORM schema inference
- **RTL Support**: Default Hebrew language with right-to-left text direction
- **Fuzzy Matching**: Franchisee name matching using aliases for supplier file parsing
- **Settlement Workflow**: Status state machine (open → processing → pending_approval → approved → invoiced)
- **Granular Permissions**: Module-level (view/edit/create/delete/approve) × 10 modules
- **Audit Trail**: Comprehensive logging of all entity changes with before/after values

## Common Development Commands

```bash
# Development
npm run dev                 # Start development server on port 3000 (with Turbopack)
npm run build              # Build for production
npm run start              # Start production server
npm run lint               # Run ESLint

# Database
npm run db:up              # Start PostgreSQL Docker container
npm run db:down            # Stop PostgreSQL Docker container
npm run db:migrate         # Run database migrations
npm run db:generate        # Generate new migration files
npm run db:studio          # Open Drizzle Studio for database management

# Testing
npm run test:e2e           # Run Playwright end-to-end tests
```

## Environment Setup

1. Copy `.env.example` to `.env` and configure:
   - Database connection (PostgreSQL)
   - Better Auth secrets
   - AWS S3/R2 credentials (for file storage)
   - Resend API key (for emails)
   - Public variables with NEXT_PUBLIC_ prefix

2. Start database and run migrations:
   ```bash
   npm run db:up
   npm run db:migrate
   ```

## Development Notes

- Uses Next.js App Router with React Server Components
- Database schema uses UUIDs for primary keys
- File uploads go directly to cloud storage via presigned URLs
- Build process includes TypeScript type checking
- Default language is Hebrew with RTL support
- All public client-side environment variables use NEXT_PUBLIC_ prefix

## RTL/Hebrew Language Support

The application is configured for Hebrew language by default:
- HTML `dir="rtl"` and `lang="he"` attributes set in root layout
- Rubik font with Hebrew subset for proper typography
- RTL-aware Tailwind CSS utilities
- Toaster notifications positioned for RTL layout

## Additional Information

- **PRD** - see `docs/PRD.md` for complete product requirements and database schema
- **Meeting Notes** - see `docs/reut_meeting.md` for original requirements discussion
- **authentication** - see `docs/authentication.md` for authentication setup
- **architecture** - see `docs/architecture.md` for layered architecture details
- **ux** - see `docs/ux.md` for user experience guidelines
- **file-uploads** - see `docs/file-uploads.md` for file upload implementation
- **suppliers** - see `docs/suppliers-reference.md` for supplier configuration, file mapping rules, commission rates, and franchisee aliases
