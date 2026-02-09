# Technology Stack

**Analysis Date:** 2026-02-09

## Languages

**Primary:**
- TypeScript 5.7.2 - Strict mode enabled for all code in `src/`

**Secondary:**
- JavaScript - Configuration files (ESM modules with `.mjs` extension)
- SQL - PostgreSQL queries through Drizzle ORM

## Runtime

**Environment:**
- Node.js - Latest LTS (no specific version pinned in package.json or .nvmrc)

**Package Manager:**
- npm (uses `package-lock.json`)
- Lockfile: Present

## Frameworks

**Core:**
- Next.js 16.1.6 - App Router with React Server Components (RSC)
- React 19.2.4 - Server and Client Components

**Styling & UI:**
- Tailwind CSS 4.1.18 - Utility-first CSS framework
- shadcn/ui - Radix UI component wrapper library
  - Radix UI primitives: `@radix-ui/*` (15+ component modules: accordion, alert-dialog, checkbox, collapsible, dialog, dropdown-menu, label, popover, progress, radio-group, select, separator, slider, tabs, tooltip)
- class-variance-authority 0.7.1 - Type-safe component variants

**Form & Validation:**
- react-hook-form 7.66.1 - Form state management
- @hookform/resolvers 5.2.2 - Validation integration
- Zod 4.1.12 - Runtime schema validation

**Database:**
- Drizzle ORM 0.44.7 - Type-safe SQL query builder
- drizzle-kit 0.31.7 - Migration and schema generation
- pg 8.16.3 - PostgreSQL client
- PostgreSQL (Neon) - Production database (serverless via connection pooling)

**Data Fetching & State:**
- TanStack Query (@tanstack/react-query) 5.90.16 - Server state management
- TanStack Router (@tanstack/react-router) 1.146.2 - Routing (supplementary)
- TanStack React Start (@tanstack/react-start) 1.146.3 - Full-stack framework features

**Authentication:**
- better-auth 1.4.10 - Email/password and OAuth authentication
- Google OAuth (via better-auth) - Social login provider

**Email & Communication:**
- Resend 6.7.0 - Email sending service (SMTP replacement)
- react-email 5.2.1 - React-based email template building
- @react-email/components 1.0.4 - Email UI components

**File Processing:**
- xlsx 0.18.5 - Excel file parsing and generation
- file-type 19.6.0 - File MIME type detection
- iconv-lite 0.7.2 - Character encoding conversion
- adm-zip 0.5.16 - ZIP file handling

**PDF Generation:**
- @react-pdf/renderer 4.3.2 - Server-side PDF rendering from React components

**Storage:**
- @vercel/blob 2.0.0 - File storage (primary document storage)
- @aws-sdk/client-s3 3.936.0 - AWS S3 client (legacy support)
- @aws-sdk/s3-request-presigner 3.936.0 - S3 presigned URL generation (legacy support)

**Payments:**
- stripe 20.0.0 - Stripe payment processing (configured but not actively used in commission workflow)

**Testing:**
- Vitest 4.0.18 - Unit test runner
  - @vitest/coverage-v8 4.0.18 - Code coverage reporting
- @playwright/test 1.49.1 - End-to-end browser testing

**UI/UX Enhancements:**
- sonner 2.0.7 - Toast notification library
- lucide-react 0.554.0 - Icon library
- next-themes 0.4.6 - Theme switching (dark/light mode)
- date-fns 4.1.0 - Date formatting and manipulation
- clsx 2.1.1 - Conditional className utility
- tailwind-merge 3.4.0 - Intelligent Tailwind class merging
- tailwindcss-animate 1.0.7 - Animation utilities

**Internationalization:**
- next-intl 3.26.5 - i18n framework for Next.js (configured for Hebrew RTL)

**Development & Build:**
- ESLint 9.17.0 with Next.js config - Code linting
- Prettier - Code formatting (no `.prettierrc` config file, uses defaults)
- PostCSS 8.4.49 - CSS transformation (Tailwind dependency)
- @tailwindcss/postcss 4.1.18 - PostCSS plugin for Tailwind v4
- dotenv-cli 11.0.0 - Environment variable loading for npm scripts
- tsx - TypeScript file runner (for seeding scripts)

## Key Dependencies

**Critical (Core Application Logic):**
- `better-auth` - Single sign-on infrastructure, session management
- `drizzle-orm` + `pg` - Type-safe database queries, connection pooling to Neon
- `@tanstack/react-query` - Background sync, cache management for UI state

**Infrastructure:**
- `@vercel/blob` - Direct document upload storage (primary cloud storage)
- `resend` - Email delivery service with webhook support
- `stripe` - Payment processing (Stripe account configured, limited usage)

**Data Handling:**
- `xlsx` - Commission file parsing and export (critical for supplier/franchisee reconciliation)
- `@react-pdf/renderer` - PDF report generation for invoice exports
- `react-email` - Templated email composition

## Configuration

**Environment:**
- Variables stored in `.env` file (see `.env.example` for template)
- Public variables prefixed with `NEXT_PUBLIC_` exposed to browser
- Secrets: `BETTER_AUTH_SECRET`, `RESEND_WEBHOOK_SECRET`, `CRON_SECRET` loaded server-side only

**Key Environment Variables:**
- `DATABASE_URL` - PostgreSQL connection string (Neon serverless)
- `BETTER_AUTH_SECRET` - Session encryption key
- `RESEND_API_KEY` - Email sending credentials
- `NEXT_PUBLIC_BETTER_AUTH_URL` - Auth callback URL (browser-accessible)
- `NEXT_PUBLIC_APP_URL` - Application base URL
- `CRON_SECRET` - Shared secret for scheduled jobs
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - OAuth credentials (optional)
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` - Cloudflare R2 credentials (legacy, not in active use)

**Build:**
- TypeScript strict mode enabled
- Next.js serverExternalPackages: `["@react-pdf/renderer"]` (SSR optimization)
- Server actions enabled with 2MB body size limit
- Image optimization for AWS S3 and Cloudflare R2 domains

## Platform Requirements

**Development:**
- Node.js (no minimum version specified)
- npm for dependency management
- PostgreSQL database (local via Docker or remote Neon)
- Docker Compose for local PostgreSQL (optional)

**Production:**
- Deployment target: Vercel (implied by Next.js v16 and `.vercel/` config patterns)
- PostgreSQL database: Neon (serverless, EU-Central-1)
- File storage: Vercel Blob or Cloudflare R2
- Email delivery: Resend
- Authentication session storage: PostgreSQL via better-auth

---

*Stack analysis: 2026-02-09*
