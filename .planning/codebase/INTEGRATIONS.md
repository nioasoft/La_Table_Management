# External Integrations

**Analysis Date:** 2026-02-09

## APIs & External Services

**Payment Processing:**
- Stripe - Payment infrastructure for subscription-based features
  - SDK: `stripe` v20.0.0
  - Auth: Environment variables `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
  - Usage: Subscription pricing (Basic/Pro tiers referenced in env config)
  - Webhook: Stripe webhook endpoint configured (script: `npm run stripe:listen`)
  - Status: Configured but not actively used in current commission workflow

**Email Delivery:**
- Resend - Transactional email service with webhook support
  - SDK: `resend` v6.7.0
  - Auth: `RESEND_API_KEY` (server-side), `RESEND_WEBHOOK_SECRET` (for webhook verification)
  - From address: `EMAIL_FROM="noreply@latable.co.il"`, `EMAIL_FROM_NAME="La Table Management"`
  - Webhook endpoint: `POST /api/webhooks/resend` - Receives delivery events (sent, delivered, bounced, complained)
  - File: `src/lib/email/service.ts` - Email sending logic
  - Fallback: Logs emails to console if `RESEND_API_KEY` not configured (development mode)

**Social Authentication:**
- Google OAuth - Third-party authentication provider
  - Credentials: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - Integration: Integrated via `better-auth` OAuth plugin
  - File: `src/utils/auth.ts` - Auth configuration

## Data Storage

**Databases:**
- PostgreSQL (Neon) - Primary application database
  - Connection: `DATABASE_URL` environment variable (Neon serverless, EU-Central-1)
  - Client: `pg` v8.16.3 with connection pooling
  - Connection pool: max 10 connections, 30s idle timeout, 10s connection timeout
  - ORM: Drizzle ORM for type-safe queries
  - File: `src/db/index.ts` - Pool configuration
  - Schema: `src/db/schema.ts` (27+ tables across domains: brands, suppliers, franchisees, commissions, settlements, etc.)

**File Storage (Primary):**
- Vercel Blob - Cloud file storage for uploaded documents
  - SDK: `@vercel/blob` v2.0.0
  - Usage: Excel/PDF uploads from suppliers/franchisees, settlement documents
  - Access: Public files via presigned URLs
  - File: `src/lib/storage.ts` - Upload/download functions
  - Allowed types: `.xlsx`, `.xls`, `.csv`, `.txt`, `.pdf`, `.doc`, `.docx`, `.png`, `.jpg`, `.jpeg`, `.gif`
  - Max file size: 10MB

**File Storage (Legacy):**
- AWS S3 / Cloudflare R2 - Legacy support for existing files
  - SDK: `@aws-sdk/client-s3` v3.936.0, `@aws-sdk/s3-request-presigner` v3.936.0
  - Credentials: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `NEXT_PUBLIC_R2_BUCKET`, `NEXT_PUBLIC_R2_ENDPOINT`
  - Status: No longer actively used; Vercel Blob is primary
  - Fallback: Local filesystem support in `src/lib/storage.ts` for backward compatibility

**Caching:**
- TanStack Query - In-memory client-side caching
  - No dedicated caching service configured (Redis/Memcached)

## Authentication & Identity

**Auth Provider:**
- better-auth - Open-source authentication framework (not Firebase/Auth0)
  - Implementation: Email/password + optional Google OAuth
  - Session storage: PostgreSQL database (via Drizzle adapter)
  - Session duration: 7 days, cookie cache 5 minutes
  - File: `src/utils/auth.ts` - Server configuration
  - File: `src/lib/auth-client.ts` - Client hooks
  - File: `src/lib/api-middleware.ts` - API route authentication helpers
  - Cookie settings: httpOnly, secure (production), sameSite: lax
  - Base URL: `NEXT_PUBLIC_BETTER_AUTH_URL` (http://localhost:3000 default)

**User Roles (Implemented):**
- `super_user` - Full system access
- `admin` - Configurable module permissions
- `franchisee_owner` - Limited to own entity data

**User Status States:**
- pending - User created, awaiting approval
- active - Approved user
- inactive - Disabled user

## Monitoring & Observability

**Error Tracking:**
- Not detected - Console logging only
- Development: `console.error()` / `console.log()` patterns used throughout
- No Sentry, Datadog, or similar service integrated

**Logs:**
- Console-based logging for development
- Database logging via Drizzle: `logger: true` in pool configuration
- Email logs: Database table `email_logs` tracks all email sending attempts with status (pending, sent, failed, delivered, bounced, complained)

**Uptime/Health Checks:**
- Not detected

## CI/CD & Deployment

**Hosting:**
- Vercel - Next.js deployment platform (inferred from Next.js 16 usage and `.vercel/` patterns)
- Vercel Blob for file storage

**CI Pipeline:**
- Not detected - No GitHub Actions, GitLab CI, or similar configuration files

**Environment Configuration:**
- Production: `NEXT_PUBLIC_BETTER_AUTH_URL="https://www.latable.co.il"` (HTTPS)
- Development: `http://localhost:3000`
- Test: Playwright configured for `http://localhost:3001`

## Environment Configuration

**Required Environment Variables (Server-Side):**
- `DATABASE_URL` - PostgreSQL connection string (critical)
- `BETTER_AUTH_SECRET` - 32+ character random string (critical)
- `CRON_SECRET` - Shared secret for scheduled jobs
- `RESEND_API_KEY` - Email sending (optional if no email needed)

**Optional Environment Variables:**
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - OAuth (if Google login disabled, not required)
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` - R2 storage (legacy, not required)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` - Stripe (not currently used)

**Public Environment Variables (Browser-Accessible):**
- `NEXT_PUBLIC_BETTER_AUTH_URL` - Auth endpoint
- `NEXT_PUBLIC_APP_URL` - Base URL for links/redirects
- `NEXT_PUBLIC_R2_BUCKET`, `NEXT_PUBLIC_R2_ENDPOINT` - R2 URLs (legacy)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - Stripe client key (if enabled)
- `NEXT_PUBLIC_STRIPE_BASIC_PRICE_ID`, `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` - Subscription pricing

**Secrets Location:**
- `.env` file (git-ignored, not committed)
- Vercel environment variables (for production)

## Webhooks & Callbacks

**Incoming Webhooks:**
- **Resend Email Webhooks:** `POST /api/webhooks/resend`
  - Events: email.sent, email.delivered, email.bounced, email.complained, email.complained_permanently
  - Signature verification: HMAC-SHA256 with `RESEND_WEBHOOK_SECRET`
  - Processor: `src/lib/email/` webhook functions
  - Updates: Email log status and metadata in database
  - Status: Verified in production only; skipped in development with warning

- **Stripe Webhooks:** (configured but no endpoint implemented yet)
  - Script: `npm run stripe:listen` for local development forwarding

**Outgoing Webhooks:**
- Not detected

## File Processing

**Supplier Commission Files:**
- Format: Excel files (.xlsx) uploaded by suppliers with commission data
- Parser: `src/lib/file-processor.ts` - Generic parser
- Custom parsers: `src/lib/custom-parsers/*` for supplier-specific formats:
  - Oren Juices (`oren-juices-parser.ts`)
  - Yaakov Agencies (`yaakov-agencies-parser.ts`)
  - Nespresso (`nespresso-parser.ts`)
  - Kiroskai (`kiroskai-parser.ts`)
  - Yama VeKadma (`yama-vekadma-parser.ts`)
  - Madag (`madag-parser.ts`)
  - Green Tea (`green-tea-parser.ts`)
  - Fandango (`fandango-parser.ts`)

**Excel Processing:**
- Library: `xlsx` v0.18.5
- Character encoding: `iconv-lite` v0.7.2 for non-UTF8 files
- File type detection: `file-type` v19.6.0

**PDF Generation:**
- Library: `@react-pdf/renderer` v4.3.2
- Use cases: Commission reports, variance reports, invoice documents
- Export endpoints: `src/app/api/commissions/*/export/route.ts`

**Fuzzy Matching:**
- Franchisee name matching via aliases
- Matcher: `src/lib/franchisee-matcher.ts` - Normalizes supplier-provided names against franchisee database

---

*Integration audit: 2026-02-09*
