# Comprehensive Codebase Audit Report

**Project:** La Table Management System
**Date:** January 12, 2026
**Auditor:** Senior Lead Software Architect & Security Auditor
**Framework:** Next.js 15 (App Router), React 19, TypeScript 5.7

---

## Executive Summary

This is a well-architected Next.js 15 full-stack application for restaurant franchise management with solid foundations but significant areas for improvement. The codebase demonstrates good separation of concerns with a layered architecture (API routes, data access layer, business logic). However, it suffers from **severe code duplication**, **oversized components**, and **missing modern React patterns**.

### Overall Grades

| Category | Score | Status |
|-----------|--------|---------|
| **Security** | 6/10 | ⚠️ Needs Attention |
| **Maintainability** | 5/10 | 🔴 Critical Issues |
| **Performance** | 6/10 | ⚠️ Needs Optimization |
| **Code Quality** | 5/10 | 🔴 High Duplication |
| **Architecture** | 7/10 | ✅ Good Foundation |
| **Type Safety** | 9/10 | ✅ Excellent |
| **Documentation** | 6/10 | ⚠️ Good but Inconsistent |

**Overall Grade:** **6/10** - Good foundation with significant room for improvement

---

## Security Findings

### 🔴 Critical Issues

#### 1. Webhook Signature Verification Bypassed in Development
**Severity:** Critical
**Location:** `src/app/api/webhooks/resend/route.ts:29-62`

**Issue:**
Webhook signature verification is skipped in development mode:

```typescript
if (process.env.NODE_ENV === "production") {
  // Verify signature
} else {
  // In development, log a warning if signature verification is skipped
  if (!signature || !webhookSecret) {
    console.warn("Skipping webhook signature verification in development mode");
  }
}
```

**Risk:** Malicious actors can spoof webhook events in development, potentially triggering actions like email re-sending, status updates, or financial operations.

**Recommendation:**
Implement environment-based verification that always verifies signatures but uses test mode flags for development. Consider using a test webhook secret for development environments.

---

#### 2. Local .env File Contains Real Secrets
**Severity:** Critical
**Location:** `.env` file (gitignored)

**Exposed Secrets:**
```bash
BETTER_AUTH_SECRET=kZ51CHbHKfPTJ1E5Tc9lguFl98WEwnVC
GOOGLE_CLIENT_ID=1078986524882-m60v4m3ir1orpmuf2dt0mpgdrdbdtlpp.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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
```

**Risk:** Although gitignored, these secrets exist locally. If committed accidentally (e.g., through git add -f, IDE auto-commit, or developer mistake), they would expose authentication and OAuth credentials to the entire world.

**Recommendation:**
- Rotate `BETTER_AUTH_SECRET` immediately
- Verify Google OAuth credentials are test credentials, not production
- Add pre-commit hooks to prevent committing `.env` files
- Use a secrets management service (e.g., HashiCorp Vault, AWS Secrets Manager) for production
- Never share `.env` files via email, chat, or version control

---

#### 3. Cron Endpoint Authentication Weakness
**Severity:** High
**Location:** `src/app/api/cron/franchisee-reminders/route.ts:369-377`

**Issue:**
If `CRON_SECRET` is not set, the endpoint becomes publicly accessible:

```typescript
if (cronSecret) {
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
} else {
  console.warn("CRON_SECRET not set - cron endpoint is accessible without authentication");
}
```

**Risk:** Anyone can trigger cron jobs by calling these endpoints, potentially causing:
- Email spam to users
- Unintended reminder processing
- Financial operations (if cron creates/completes settlements)
- Database load and performance degradation

**Recommendation:**
Make `CRON_SECRET` mandatory in production. Throw an error if not configured:

```typescript
const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("CRON_SECRET must be set in production");
  }
  console.error("CRON_SECRET not set - cron endpoint is disabled");
  return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
}
```

---

#### 4. Public Upload Endpoint IP Address Collection
**Severity:** Medium
**Location:** `src/app/api/public/upload/[token]/route.ts:165-168`

**Issue:**
Client IP address is collected and stored without explicit consent:

```typescript
const forwardedFor = request.headers.get("x-forwarded-for");
const clientIp = forwardedFor
  ? forwardedFor.split(",")[0].trim()
  : request.headers.get("x-real-ip") || "unknown";
```

**Risk:**
Potential GDPR/privacy violation depending on data residency requirements. Storing IP addresses without clear consent and purpose documentation may violate privacy regulations.

**Recommendation:**
- Document IP address collection in privacy policy
- Obtain explicit consent from uploaders
- Consider removing unnecessary collection if not used for abuse prevention
- Implement IP address retention/deletion policy

---

### 🟠 High-Priority Issues

#### 5. Missing Rate Limiting on API Routes
**Severity:** High
**Impact:** All API endpoints

**Issue:**
No rate limiting implemented on any API endpoints. All endpoints can be called arbitrarily fast.

**Risk:**
- Brute force attacks on authentication endpoints
- API abuse and DoS attacks
- Financial operations spam
- Database overload and performance degradation

**Recommendation:**
Implement rate limiting using:
- Middleware with in-memory store (development)
- Redis/Upstash (production)
- Third-party services like Cloudflare, Vercel Edge Config

Example implementation:
```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "10 s"), // 10 requests per 10 seconds
  analytics: true,
});

export async function middleware(request: NextRequest) {
  const ip = request.ip || "unknown";
  const { success } = await ratelimit.limit(ip);

  if (!success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
}
```

---

#### 6. No CSRF Protection for Non-GET Requests
**Severity:** High
**Impact:** All POST, PATCH, DELETE endpoints

**Issue:**
API routes use Better Auth session cookies but don't validate CSRF tokens explicitly for mutation operations.

**Risk:**
Cross-site request forgery attacks could trigger unauthorized actions when users visit malicious sites while logged in.

**Recommendation:**
Better Auth provides CSRF protection. Ensure it's properly configured and validated in all mutation endpoints:

```typescript
// In API route handlers
import { headers } from "next/headers";

export async function POST(request: NextRequest) {
  const csrfToken = request.headers.get("x-better-auth-csrf-token");
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!csrfToken || session.csrfToken !== csrfToken) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }
}
```

---

#### 7. File Upload MIME Type Validation Weakness
**Severity:** High
**Location:** `src/app/api/public/upload/[token]/route.ts:132-140`

**Issue:**
File type validation relies solely on `file.type` which can be spoofed by browsers:

```typescript
if (!allowedTypes.includes(file.type) && !isAllowedFileType(file.type)) {
  return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
}
```

**Risk:**
Attackers can upload malicious files (e.g., `.exe`, `.sh`, `.php`) with spoofed MIME types (e.g., `application/pdf`), bypassing validation.

**Recommendation:**
Validate file magic numbers (file signatures) instead of relying solely on MIME types:

```typescript
import { fileTypeFromBuffer } from 'file-type';

// In upload handler
const buffer = await file.arrayBuffer();
const fileType = await fileTypeFromBuffer(buffer);

if (!allowedFileSignatures.includes(fileType.mime)) {
  return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
}
```

---

### 🟡 Medium-Priority Issues

#### 8. Database Password Exposed in Docker Compose
**Severity:** Medium
**Location:** `docker-compose.yml:9`

**Issue:**
Default PostgreSQL password is hardcoded:

```yaml
POSTGRES_PASSWORD: example
```

**Risk:**
If deployed to production with default credentials, the database is immediately compromised.

**Recommendation:**
Use environment variables for all sensitive configuration:

```yaml
services:
  latable-db:
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_HOST_AUTH_METHOD: ${POSTGRES_HOST_AUTH_METHOD}
```

---

#### 9. No Input Sanitization Before Database Insertion
**Severity:** Medium
**Impact:** All user input handling

**Issue:**
While Drizzle ORM provides SQL injection protection, there's no explicit sanitization of user inputs for XSS prevention.

**Risk:**
Stored XSS attacks if data is later rendered without sanitization in client components.

**Recommendation:**
Implement input sanitization middleware and use DOMPurify for HTML content:

```typescript
import DOMPurify from 'isomorphic-dompurify';

export function sanitizeInput(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [] });
}

export function sanitizeHtml(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: ['b', 'i', 'u', 'a', 'strong', 'em'],
    ALLOWED_ATTR: ['href'],
  });
}
```

---

#### 10. Environment Variable Missing from .env.example
**Severity:** Low
**Issue:**
`CRON_SECRET` is used in code but not documented in `.env.example`.

**Risk:**
Developers may not configure the secret, leaving cron endpoints vulnerable (see Issue #3).

**Recommendation:**
Add to `.env.example`:

```bash
# Cron Job Authentication
CRON_SECRET=your-random-secret-key-here
```

---

### ✅ Security Strengths

1. **Proper environment variable usage** - No hardcoded secrets in source code
2. **Better Auth integration** - Modern, feature-rich authentication library
3. **Role-based access control** - Granular permissions implemented (view, edit, create, delete, approve)
4. **Webhook signature verification** - Timing-safe comparison implemented using crypto.timingSafeEqual()
5. **Comprehensive audit logging** - Audit log table tracks all sensitive actions
6. **Secure session management** - Cookie-based sessions with configurable expiration
7. **Secure file upload links** - Token-based, expiring upload links with file limits
8. **PostgreSQL with Drizzle ORM** - Type-safe queries, parameterized statements prevent SQL injection
9. **API route method restrictions** - Explicit GET/POST/PATCH/DELETE handlers
10. **Middleware authentication** - Protected route groups in App Router

---

## Architectural Review

### Folder Structure Analysis

**Rating:** ✅ Good (7/10)

The project follows a well-organized layered architecture:

```
src/
├── app/                          # Next.js App Router
│   ├── (protected)/              # Authenticated routes group
│   ├── api/                     # API routes (77 endpoints)
│   │   ├── auth/               # Better Auth handler
│   │   ├── cron/               # Scheduled tasks
│   │   ├── public/              # Public endpoints (uploads)
│   │   ├── webhooks/            # External service webhooks
│   │   ├── audit-logs/         # Audit logging
│   │   ├── brands/              # Brand management
│   │   ├── suppliers/           # Supplier management
│   │   ├── franchisees/         # Franchisee management
│   │   ├── commissions/         # Commission calculations
│   │   ├── settlements/         # Financial settlements
│   │   ├── reconciliation/      # Data reconciliation
│   │   ├── reports/            # Report generation
│   │   ├── users/              # User management
│   │   ├── management-companies/ # Invoice-issuing companies
│   │   ├── documents/           # Document management
│   │   ├── file-requests/      # File upload requests
│   │   ├── email-templates/     # Email template management
│   │   └── dashboard/          # Dashboard widgets
│   ├── upload/                  # Public upload pages
│   └── layout.tsx               # Root layout
├── components/                  # React components
│   ├── ui/                     # shadcn/ui base components
│   └── [domain components]      # Business logic components
├── data-access/                # Database queries (clean separation)
│   ├── users.ts
│   ├── franchisees.ts
│   ├── suppliers.ts
│   ├── brands.ts
│   ├── commissions.ts
│   ├── settlements.ts
│   ├── adjustments.ts
│   ├── reconciliation.ts
│   ├── documents.ts
│   ├── auditLog.ts
│   ├── emailTemplates.ts
│   ├── fileRequests.ts
│   ├── uploadLinks.ts
│   ├── franchiseeReminders.ts
│   └── managementCompanies.ts
├── db/                         # Database schema and connection
│   ├── index.ts                # Database connection
│   └── schema.ts               # Drizzle schema definitions (1,600+ lines)
├── lib/                        # Shared utilities and business logic
│   ├── storage.ts              # File upload (R2/S3)
│   ├── auth-client.ts          # Client-side auth utilities
│   ├── permissions.ts          # Permission checking utilities
│   ├── file-processor.ts      # Excel/CSV parsing
│   ├── email/                 # Email service and webhooks
│   └── notifications/          # Notification system
├── hooks/                      # Custom React hooks (minimal usage)
├── queries/                    # TanStack Query definitions (unused)
├── utils/                      # Utility functions
├── config/                     # Configuration
├── emails/                     # Email templates (@react-email)
└── styles/                     # Global CSS and Tailwind config
```

**Strengths:**
- Clear separation between UI, data access, and business logic
- Proper use of Next.js App Router conventions with route groups `(protected)`
- shadcn/ui provides consistent, accessible component library
- Data access layer abstracts database operations
- Comprehensive schema with proper relations and indexes

**Weaknesses:**
- `queries/` directory exists but is empty (TanStack Query installed but unused)
- Mixed concerns in API routes (validation, business logic, data access in single files)
- No shared middleware or utilities for common patterns
- No global state management
- Manual data fetching throughout codebase

---

### Technology Stack Assessment

**Core Technologies:**
- **Framework:** Next.js 15.1.3 with App Router ✅ (Latest, production-ready)
- **React:** 19.0.0 ✅ (Latest, concurrent features available)
- **TypeScript:** 5.7.2 ✅ (Latest, strict mode enabled)
- **Database:** PostgreSQL 17 with Drizzle ORM 0.44.7 ✅ (Type-safe, modern)
- **Authentication:** Better Auth 1.4.10 ✅ (Modern, feature-rich)
- **Storage:** AWS S3/Cloudflare R2 with presigned URLs ✅ (Secure, scalable)
- **Email:** Resend 6.7.0 ✅ (Modern email service with webhooks)
- **UI:** shadcn/ui + Tailwind CSS 3.4.17 ✅ (Consistent, accessible, customizable)

**Additional Libraries:**
- **Forms:** React Hook Form 7.66.1 with Zod 4.1.12 ✅ (Installed, minimally used)
- **Data Fetching:** TanStack Query 5.90.16 ⚠️ (Installed but NOT USED)
- **Routing:** TanStack React Router 1.146.2 ⚠️ (Installed but NOT USED - Next.js App Router used instead)
- **Excel Processing:** xlsx 0.18.5 ✅ (Robust file parsing)
- **PDF Generation:** @react-pdf/renderer 4.3.2 ✅ (Server-side PDF generation)
- **Email Templates:** @react-email/components 1.0.4 ✅ (Component-based emails)

**Missing:**
- State management library (Zustand, Jotai, Redux) - No global state
- Form validation library integration (React Hook Form with Zod - installed but underutilized)
- Error boundary components - No graceful error handling
- Loading skeleton components - Basic spinners only
- Testing utilities - Minimal test coverage

---

### Scalability Concerns

1. **No Caching Strategy**
   - Every API call hits the database directly
   - No response caching at any layer
   - Repeated data fetches for same resources

2. **Database Connection Management**
   - Connection pooling configuration not visible
   - May hit connection limits under load
   - No connection health checks

3. **Static Asset Delivery**
   - No CDN configuration visible
   - Static assets served directly from Next.js
   - Images served via API instead of optimized Image component

4. **Database Query Optimization**
   - Indexes exist but not optimized for query patterns
   - No EXPLAIN analysis or query performance monitoring
   - Large result sets without pagination limits

5. **Background Job Processing**
   - Cron jobs run synchronously in HTTP handlers
   - No job queue for long-running tasks
   - Webhook processing could timeout

6. **File Storage**
   - No CDN distribution strategy
   - No file compression or optimization
   - No automatic cleanup of old files

---

## Code Quality & Redundancy

### 🔴 Critical Code Duplication

#### 1. Authentication & Authorization Blocks (100+ occurrences)

**Pattern repeated in 100+ API routes:**

```typescript
const session = await auth.api.getSession({ headers: request.headers });

if (!session) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

const userRole = (session.user as typeof session.user & { role?: string }).role;
if (userRole !== "super_user" && userRole !== "admin") {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

**Affected Files:**
- All routes in `/api/franchisees/`, `/api/brands/`, `/api/suppliers/`, `/api/management-companies/`, `/api/users/`, `/api/commissions/`, `/api/settlements/`, `/api/reconciliation/`, `/api/email-templates/`, `/api/documents/`, `/api/file-requests/`, `/api/upload-links/`

**Impact:**
- 500+ lines of duplicated code
- Difficult to maintain authentication logic
- Inconsistent error messages
- If authentication logic changes, requires updates in 100+ files

**Solution:**

Create middleware utilities in `src/lib/api-middleware.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import type { UserRole } from "@/db/schema";

export async function requireAuth(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  return session;
}

export async function requireRole(request: NextRequest, allowedRoles: UserRole[]) {
  const session = await requireAuth(request);

  const userRole = (session.user as typeof session.user & { role?: string }).role;

  if (!userRole || !allowedRoles.includes(userRole)) {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  return session;
}

export async function requireSuperUser(request: NextRequest) {
  return requireRole(request, ["super_user"]);
}

export async function requireAdminOrSuperUser(request: NextRequest) {
  return requireRole(request, ["super_user", "admin"]);
}

export async function requireAnyAuthenticatedUser(request: NextRequest) {
  return requireRole(request, ["super_user", "admin", "franchisee_owner"]);
}
```

Usage in API routes:

```typescript
import { requireAdminOrSuperUser } from "@/lib/api-middleware";

export async function GET(request: NextRequest) {
  const session = await requireAdminOrSuperUser(request);
  // If we reach here, user is authenticated and authorized
  // ... rest of handler
}
```

---

#### 2. Data Access Pattern Duplication (16+ identical functions)

**Pattern repeated across entities:**

**getById pattern (8 identical implementations):**
```typescript
export async function getBrandById(id: string): Promise<Brand | null> {
  const results = await database
    .select()
    .from(brand)
    .where(eq(brand.id, id))
    .limit(1) as unknown as Brand[];
  return results[0] || null;
}

export async function getSupplierById(id: string): Promise<Supplier | null> {
  const results = await database
    .select()
    .from(supplier)
    .where(eq(supplier.id, id))
    .limit(1) as unknown as Supplier[];
  return results[0] || null;
}

// ... repeated for users, commissions, adjustments, etc.
```

**getActive pattern (8 identical implementations):**
```typescript
export async function getActiveFranchisees(): Promise<Franchisee[]> {
  return database
    .select()
    .from(franchisee)
    .where(eq(franchisee.isActive, true))
    .orderBy(desc(franchisee.createdAt)) as unknown as Promise<Franchisee[]>;
}

export async function getActiveBrands(): Promise<Brand[]> {
  return database
    .select()
    .from(brand)
    .where(eq(brand.isActive, true))
    .orderBy(desc(brand.createdAt)) as unknown as Promise<Brand[]>;
}

// ... repeated for suppliers, users, emailTemplates, etc.
```

**isCodeUnique pattern (4 identical implementations):**
```typescript
export async function isFranchiseeCodeUnique(code: string, excludeId?: string): Promise<boolean> {
  const existingFranchisee = await getFranchiseeByCode(code);
  if (!existingFranchisee) return true;
  if (excludeId && existingFranchisee.id === excludeId) return true;
  return false;
}

export async function isBrandCodeUnique(code: string, excludeId?: string): Promise<boolean> {
  const existingBrand = await getBrandByCode(code);
  if (!existingBrand) return true;
  if (excludeId && existingBrand.id === excludeId) return true;
  return false;
}

// ... repeated for suppliers, management companies
```

**getStats pattern (4 identical implementations):**
```typescript
export async function getFranchiseeStats(): Promise<Stats> {
  const [allFranchisees, activeFranchisees, inactiveFranchisees] = await Promise.all([
    database.select({ count: count() }).from(franchisee),
    database.select({ count: count() }).from(franchisee).where(eq(franchisee.isActive, true)),
    database.select({ count: count() }).from(franchisee).where(eq(franchisee.isActive, false)),
  ]);

  return {
    total: allFranchisees[0]?.count || 0,
    active: activeFranchisees[0]?.count || 0,
    inactive: inactiveFranchisees[0]?.count || 0,
  };
}

// ... repeated for brands, suppliers, management companies
```

**Impact:**
- 200+ lines of duplicated code
- Inconsistent implementations across entities
- Bug fixes require updates in multiple files

**Solution:**

Create generic factories in `src/lib/data-access-helpers.ts`:

```typescript
import { PgTable, eq } from "drizzle-orm";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";

export interface GetByIdResult<T> {
  byId: (id: string) => Promise<T | null>;
}

export function createGetById<T extends Record<string, any>>(
  table: PgTable
): GetByIdResult<T> {
  return {
    byId: async (id: string) => {
      const results = await database
        .select()
        .from(table)
        .where(eq(table.id, id))
        .limit(1) as unknown as T[];
      return results[0] || null;
    },
  };
}

export interface GetActiveResult<T> {
  all: () => Promise<T[]>;
}

export function createGetActive<T extends Record<string, any> & { isActive: boolean }>(
  table: PgTable & { isActive: any }
): GetActiveResult<T> {
  return {
    all: async () => {
      return database
        .select()
        .from(table)
        .where(eq(table.isActive, true))
        .orderBy(table.createdAt) as unknown as Promise<T[]>;
    },
  };
}

export interface IsCodeUniqueResult {
  check: (code: string, excludeId?: string) => Promise<boolean>;
}

export function createIsCodeUnique<T extends Record<string, any> & { code: string }>(
  table: PgTable,
  getByCode: (code: string) => Promise<T | null>
): IsCodeUniqueResult {
  return {
    check: async (code: string, excludeId?: string) => {
      const existing = await getByCode(code);
      if (!existing) return true;
      if (excludeId && existing.id === excludeId) return true;
      return false;
    },
  };
}
```

Usage in data access files:

```typescript
// src/data-access/brands.ts
import { createGetById, createGetActive, createIsCodeUnique } from "@/lib/data-access-helpers";
import { brand } from "@/db/schema";

export const getBrandById = createGetById(brand).byId;
export const getActiveBrands = createGetActive(brand).all;
export const isBrandCodeUnique = createIsCodeUnique(brand, getBrandByCode).check;
```

---

#### 3. Currency Formatting Duplication (14+ implementations)

**Pattern repeated in multiple components:**

```typescript
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
  }).format(amount);
};
```

**Locations:**
- `src/components/franchisee-detail-card.tsx` (line 163)
- `src/components/commission-settlement-widget.tsx`
- `src/components/minimal-dashboard.tsx`
- `src/app/(protected)/admin/commissions/brand/page.tsx` (25 occurrences)
- `src/app/(protected)/admin/commissions/franchisee/page.tsx` (13 occurrences)
- `src/app/(protected)/admin/commissions/invoice/page.tsx` (9 occurrences)
- Plus 8 more commission/report pages

**Impact:**
- ~50 lines of duplicated code
- Inconsistent formatting across components
- Currency locale hardcoded in 14+ places

**Solution:**

Extract to `src/lib/formatters.ts`:

```typescript
/**
 * Format a number as Israeli Shekel currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a number with thousand separators
 */
export function formatNumber(amount: number, decimals: number = 2): string {
  return new Intl.NumberFormat("he-IL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

/**
 * Format a percentage
 */
export function formatPercentage(value: number, decimals: number = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format a date in Hebrew locale
 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("he-IL");
}

/**
 * Format a date-time in Hebrew locale
 */
export function formatDateTime(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("he-IL", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
```

Usage in components:

```typescript
import { formatCurrency, formatDate, formatDateTime } from "@/lib/formatters";

// Use throughout component
<td>{formatCurrency(commission.amount)}</td>
<td>{formatDate(commission.invoiceDate)}</td>
<td>{formatDateTime(commission.createdAt)}</td>
```

---

#### 4. Manual Data Fetching Duplication (97+ fetch() calls)

**Pattern repeated 97+ times:**

```typescript
const fetchStats = async () => {
  try {
    setIsLoading(true);
    setError(null);
    const response = await fetch("/api/dashboard/stats");
    if (!response.ok) {
      throw new Error("Failed to fetch dashboard stats");
    }
    const data = await response.json();
    setStats(data.stats);
  } catch (err) {
    console.error("Error fetching dashboard stats:", err);
    setError("failed_to_load");
  } finally {
    setIsLoading(false);
  }
};
```

**Locations:**
- 97+ manual fetch calls across components
- Dashboard widgets, admin pages, detail cards, forms

**Impact:**
- ~1,500+ lines of boilerplate code
- No caching - same data fetched multiple times
- No request deduplication
- No retry logic on failures
- No stale-while-revalidate
- No optimistic updates
- Race conditions possible

**Solution:**

Use TanStack Query (already installed at `@tanstack/react-query`):

```typescript
// src/hooks/use-dashboard-stats.ts
import { useQuery } from "@tanstack/react-query";

export function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: async () => {
      const response = await fetch("/api/dashboard/stats");
      if (!response.ok) {
        throw new Error("Failed to fetch dashboard stats");
      }
      const data = await response.json();
      return data.stats;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 3,
  });
}
```

Usage in components:

```typescript
import { useDashboardStats } from "@/hooks/use-dashboard-stats";

function Dashboard() {
  const { data: stats, isLoading, error, refetch } = useDashboardStats();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <div>
      <StatCard label="Total Franchisees" value={stats?.totalFranchisees} />
      <StatCard label="Pending Approvals" value={stats?.pendingApprovals} />
      <button onClick={() => refetch()}>Refresh</button>
    </div>
  );
}
```

---

### 🔴 Oversized Components

#### 1. franchisees/page.tsx - 1,780 lines

**File Path:** `src/app/(protected)/admin/franchisees/page.tsx`

**Issues:**
- 22 `useState` hooks managing disparate concerns
- Nested `FranchiseeCard` component (449 lines) within same file
- Mixes data fetching, form handling, modal management, filtering, UI rendering
- Multiple independent data fetching flows (franchisees, brands, documents, status history)
- Status change modal, status change confirmation, history tracking all in one component

**State Management Chaos:**
```typescript
const [isLoading, setIsLoading] = useState(true);
const [franchisees, setFranchisees] = useState<...>([]);
const [brands, setBrands] = useState<...>([]);
const [stats, setStats] = useState<...>([]);
const [filterBrand, setFilterBrand] = useState<string>("all");
const [filterStatus, setFilterStatus] = useState<string>("all");
const [showForm, setShowForm] = useState(false);
const [editingFranchisee, setEditingFranchisee] = useState<...>(null);
const [formData, setFormData] = useState<...>(initialFormData);
const [isSubmitting, setIsSubmitting] = useState(false);
const [formError, setFormError] = useState<string | null>(null);
const [expandedDocumentsId, setExpandedDocumentsId] = useState<string | null>(null);
const [loadingDocumentsId, setLoadingDocumentsId] = useState<string | null>(null);
const [franchiseeDocuments, setFranchiseeDocuments] = useState<...>({});
const [statusChangeModal, setStatusChangeModal] = useState<...>({...});
const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null);
const [franchiseeHistory, setFranchiseeHistory] = useState<...>({});
const [detailViewFranchisee, setDetailViewFranchisee] = useState<...>(null);
```

**Recommendation - Break Down Into:**

1. **Extract Custom Hooks:**
   ```typescript
   // src/hooks/use-franchisees.ts
   export function useFranchisees(filters?: FranchiseeFilters) {
     const { data: franchisees, isLoading, error } = useQuery({
       queryKey: ["franchisees", filters],
       queryFn: () => fetchFranchisees(filters),
     });
     return { franchisees, isLoading, error };
   }

   // src/hooks/use-franchisee-filters.ts
   export function useFranchiseeFilters() {
     const [filterBrand, setFilterBrand] = useState("all");
     const [filterStatus, setFilterStatus] = useState("all");
     return { filterBrand, setFilterBrand, filterStatus, setFilterStatus };
   }
   ```

2. **Extract Child Components:**
   ```typescript
   // src/components/franchisee/FRanchiseeList.tsx
   // src/components/franchisee/FranchiseeForm.tsx
   // src/components/franchisee/FranchiseeFilters.tsx
   // src/components/franchisee/FranchiseeStatusChangeModal.tsx
   // src/components/franchisee/FranchiseeDetailView.tsx
   ```

3. **Create Compound Component:**
   ```typescript
   // src/components/franchisee/FranchiseeCard.tsx (compound pattern)
   <FranchiseeCard data={franchisee}>
     <FranchiseeCard.Header />
     <FranchiseeCard.Actions />
     <FranchiseeCard.Documents />
     <FranchiseeCard.StatusHistory />
   </FranchiseeCard>
   ```

4. **Result:** Main page reduces to ~200 lines focused on composition

---

#### 2. suppliers/page.tsx - 1,319 lines

**File Path:** `src/app/(protected)/admin/suppliers/page.tsx`

**Issues:**
- Similar complexity to franchisees page
- File upload, file mapping, commission management all in one component
- Multiple modal dialogs
- Complex form validation logic embedded in component

**Recommendation:**
Apply same breakdown pattern as franchisees page:
- Extract `useSuppliers()` hook
- Extract `useSupplierForm()` hook
- Extract `SupplierForm`, `FileMappingEditor`, `CommissionExceptionsEditor` components
- Create compound `SupplierCard` component

---

#### 3. Other Large Components

| Component | Lines | Issue | Recommended Action |
|-----------|--------|---------|-------------------|
| `reports/page.tsx` | 1,162 | Multiple report types in one component | Split into separate pages per report type |
| `reconciliation/page.tsx` | 1,096 | Complex cross-reference matching | Extract matching logic to hooks/services |
| `commissions/supplier/page.tsx` | 939 | Large table with filtering/sorting | Use data table library |
| `franchisee-detail-card.tsx` | 913 | Nested component with many tabs | Extract tab content to separate components |
| `document-manager.tsx` | 656 | File upload + list + management | Split into separate components |
| `permissions-editor.tsx` | 331 | Complex permission matrix | Extract to reusable component |

---

### Severe Prop Drilling

**Example - FranchiseeCard:**

**Props Passed:** 12+ properties

```typescript
interface FranchiseeCardProps {
  franchisee: FranchiseeWithBrandAndContacts;
  userRole: string | undefined;
  onEdit: (franchisee: FranchiseeWithBrandAndContacts) => void;
  onStatusChange: (franchisee: FranchiseeWithBrandAndContacts, status: FranchiseeStatus) => void;
  documents: DocumentWithUploader[];
  onDocumentsChange: (documents: DocumentWithUploader[]) => void;
  isDocumentsExpanded: boolean;
  isLoadingDocuments: boolean;
  onToggleDocuments: () => void;
  statusHistory: StatusHistoryEntry[];
  isHistoryExpanded: boolean;
  isLoadingHistory: boolean;
  onToggleHistory: () => void;
  onViewDetails: (franchisee: FranchiseeWithBrandAndContacts) => void;
}
```

**Usage in Parent (lines 1888-1904):**

```typescript
<FranchiseeCard
  key={franchisee.id}
  franchisee={franchisee}
  userRole={userRole}
  onEdit={handleEdit}
  onStatusChange={openStatusChangeModal}
  documents={franchiseeDocuments[franchisee.id] || []}
  onDocumentsChange={(docs) => handleDocumentsChange(franchisee.id, docs)}
  isDocumentsExpanded={expandedDocumentsId === franchisee.id}
  isLoadingDocuments={loadingDocumentsId === franchisee.id}
  onToggleDocuments={() => toggleDocumentsExpanded(franchisee.id)}
  statusHistory={franchiseeHistory[franchisee.id] || []}
  isHistoryExpanded={expandedHistoryId === franchisee.id}
  isLoadingHistory={loadingHistoryId === franchisee.id}
  onToggleHistory={() => toggleHistoryExpanded(franchisee.id)}
  onViewDetails={handleViewDetails}
/>
```

**Problems:**
- Parent component manages all expansion/loading states
- Documents and history data fetched in parent, passed down through props
- Difficult to test components in isolation
- Cannot reuse components in different contexts
- Props become unwieldy as features are added

**Recommendation 1 - React Context:**

```typescript
// src/contexts/franchisee-context.tsx
interface FranchiseeContextValue {
  documents: Map<string, DocumentWithUploader[]>;
  loadDocuments: (franchiseeId: string) => Promise<void>;
  toggleDocumentsExpanded: (franchiseeId: string) => void;
  // ... other shared state
}

const FranchiseeContext = createContext<FranchiseeContextValue | null>(null);

export function FranchiseeProvider({ children }: { children: React.ReactNode }) {
  // Manage all shared state here
  return (
    <FranchiseeContext.Provider value={contextValue}>
      {children}
    </FranchiseeContext.Provider>
  );
}

export function useFranchiseeContext() {
  const context = useContext(FranchiseeContext);
  if (!context) throw new Error("useFranchiseeContext must be used within FranchiseeProvider");
  return context;
}
```

Usage in components:

```typescript
function FranchiseeCard({ franchisee }: { franchisee: Franchisee }) {
  const { documents, loadDocuments, toggleDocumentsExpanded } = useFranchiseeContext();

  // No props for documents/history
}
```

**Recommendation 2 - Compound Components:**

```typescript
// Compound component pattern
function FranchiseeCard({ data, children }: { data: Franchisee, children: React.ReactNode }) {
  return (
    <Card>
      <FranchiseeCardHeader data={data} />
      {children}
    </Card>
  );
}

function FranchiseeCardHeader({ data }: { data: Franchisee }) {
  return (
    <CardHeader>
      <Title>{data.name}</Title>
      <Actions>{/* Edit/Delete buttons */}</Actions>
    </CardHeader>
  );
}

// Usage
<FranchiseeCard data={franchisee}>
  <FranchiseeCardDocuments data={franchisee} />
  <FranchiseeCardHistory data={franchisee} />
</FranchiseeCard>
```

---

### Client vs Server Component Usage

**Finding:** 48 out of 59 TSX files use `"use client"` (81%)

**Issue:**
Heavy reliance on client-side rendering means:
- Reduced SEO potential for admin pages (though less critical)
- More JavaScript shipped to client
- Missed opportunities for server-side rendering benefits
- Slower initial page loads
- Data fetched on client instead of server

**Files WITHOUT `"use client"` (11 files):**
- `src/app/layout.tsx` - Root layout ✅
- `src/app/page.tsx` - Landing page ✅
- `src/app/(protected)/admin/email-templates/page.tsx` - Admin page ❓ (Should be client for interactivity)
- `src/components/ui/badge.tsx` ❓ (Could be server component)
- `src/components/ui/card.tsx` ❓ (Could be server component)
- `src/components/ui/table.tsx` ❓ (Could be server component)
- `src/components/ui/tabs.tsx` ❓ (Could be server component)
- `src/components/ui/textarea.tsx` ❓ (Could be server component)
- Email template files (6 in `/src/emails/`) ✅ (Correct - server components)

**Recommendation:**

Mark appropriate components as server components:

```typescript
// Good: Pure display components
export default function Badge({ variant, children }: BadgeProps) {
  return <span className={cn(variants[variant])}>{children}</span>;
}

// Bad: Components with interactivity
"use client";
export default function Button({ onClick, children }: ButtonProps) {
  return <button onClick={onClick}>{children}</button>;
}

// Good: Server components with client interactivity children
export default function FranchiseeList({ franchisees }: { franchisees: Franchisee[] }) {
  return (
    <div>
      {franchisees.map(f => (
        <FranchiseeCard key={f.id} franchisee={f} />
      ))}
    </div>
  );
}
"use client";
function FranchiseeCard({ franchisee }: { franchisee: Franchisee }) {
  const [expanded, setExpanded] = useState(false);
  return <Card onClick={() => setExpanded(!expanded)}>{/* ... */}</Card>;
}
```

---

## Performance Bottlenecks

### 1. No Caching Strategy

**Current Behavior:**
```typescript
// Dashboard fetches stats
const response = await fetch("/api/dashboard/stats");

// Franchisee page fetches stats again
const response = await fetch("/api/dashboard/stats");

// Commission page fetches same stats again
const response = await fetch("/api/dashboard/stats");
```

**Impact:**
- Same data fetched multiple times
- Database hit on every page navigation
- Unnecessary network requests
- Slower perceived performance

**Solution - Multi-Layer Caching:**

**1. Server-Side Caching (TanStack Query):**
```typescript
// In data access layer
export async function getDashboardStats() {
  // Check cache first
  const cached = await redis.get("dashboard:stats");
  if (cached) return JSON.parse(cached);

  const stats = await database
    .select({ ... })
    .from(...);

  // Cache for 5 minutes
  await redis.setex("dashboard:stats", 300, JSON.stringify(stats));
  return stats;
}
```

**2. Edge Caching (Vercel Edge Config):**
```typescript
// API route
export async function GET(request: NextRequest) {
  const stats = await getDashboardStats();

  return NextResponse.json({ stats }, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
    },
  });
}
```

**3. Client-Side Caching (TanStack Query):**
```typescript
const { data } = useQuery({
  queryKey: ["dashboard", "stats"],
  queryFn: fetchDashboardStats,
  staleTime: 5 * 60 * 1000, // 5 minutes
  cacheTime: 10 * 60 * 1000, // 10 minutes
});
```

---

### 2. Manual Data Fetching Without Optimization

**Issues:**
- No request deduplication
- No automatic retries
- No stale-while-revalidate
- No optimistic updates
- No background refetching

**Impact:**
- Slower UX
- More network requests
- Race conditions possible
- No error recovery

**Solution - TanStack Query Migration:**

Replace 97+ manual fetch calls with TanStack Query:

```typescript
// Create hooks in src/hooks/
// src/hooks/use-franchisees.ts
export function useFranchisees(filters?: Filters) {
  return useQuery({
    queryKey: ["franchisees", filters],
    queryFn: () => fetchFranchisees(filters),
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error.status === 404) return false;
      if (failureCount < 3) return true;
      return false;
    },
  });
}

// src/hooks/use-franchisee.ts
export function useFranchisee(id: string) {
  return useQuery({
    queryKey: ["franchisee", id],
    queryFn: () => fetchFranchisee(id),
    enabled: !!id, // Only fetch if id exists
  });
}

// src/hooks/use-mutation-franchisee.ts
export function useUpdateFranchisee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateFranchiseeData) => updateFranchisee(data),
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ["franchisees"] });
      queryClient.invalidateQueries({ queryKey: ["franchisee", data.id] });
    },
  });
}
```

**Benefits:**
- Automatic caching
- Request deduplication
- Background refetching
- Optimistic updates
- Error retries with exponential backoff
- React Suspense integration
- DevTools for debugging

---

### 3. Unnecessary Re-renders

**Example from franchisees/page.tsx:**

```typescript
// These state changes cause entire 1,780-line component to re-render
const [filterBrand, setFilterBrand] = useState<string>("all");
const [filterStatus, setFilterStatus] = useState<string>("all");
const [showForm, setShowForm] = useState(false);
```

**Impact:**
Filter changes re-render entire page including all list items, forms, and modals.

**Solution 1 - React.memo:**

```typescript
const FranchiseeCard = React.memo(({ franchisee, onEdit, ... }: FranchiseeCardProps) => {
  // Component body
}, (prev, next) => {
  // Only re-render if franchisee data actually changed
  return prev.franchisee.id === next.franchisee.id &&
         prev.franchisee.updatedAt === next.franchisee.updatedAt;
});
```

**Solution 2 - useReducer for Complex State:**

```typescript
type FranchiseeState = {
  franchisees: Franchisee[];
  filterBrand: string;
  filterStatus: string;
  showForm: boolean;
  // ... other state
};

type FranchiseeAction =
  | { type: "SET_FRANCHISEES"; payload: Franchisee[] }
  | { type: "SET_FILTER_BRAND"; payload: string }
  | { type: "SET_FILTER_STATUS"; payload: string }
  // ... other actions
  | { type: "TOGGLE_FORM" };

function franchiseeReducer(state: FranchiseeState, action: FranchiseeAction): FranchiseeState {
  switch (action.type) {
    case "SET_FRANCHISEES":
      return { ...state, franchisees: action.payload };
    case "SET_FILTER_BRAND":
      return { ...state, filterBrand: action.payload };
    case "SET_FILTER_STATUS":
      return { ...state, filterStatus: action.payload };
    case "TOGGLE_FORM":
      return { ...state, showForm: !state.showForm };
    default:
      return state;
  }
}

// In component
const [state, dispatch] = useReducer(franchiseeReducer, initialState);
```

---

### 4. No Code Splitting Strategy

**Finding:**
All admin pages load all dependencies upfront, including heavy libraries.

**Impact:**
- Large initial bundle size
- Slower initial page load
- Unnecessary JavaScript downloaded

**Solution - Dynamic Imports:**

```typescript
// Heavy components with PDF generation
const CommissionReportPDF = dynamic(
  () => import('@/components/reports/CommissionReportPDF'),
  {
    loading: () => <LoadingSpinner />,
    ssr: false, // PDF generation is client-only
  }
);

// Heavy chart libraries
const ChartComponent = dynamic(
  () => import('@/components/charts/RevenueChart'),
  {
    loading: () => <Skeleton />,
  }
);

// Modal dialogs that don't need to be in initial bundle
const FranchiseeFormModal = dynamic(
  () => import('@/components/franchisee/FranchiseeFormModal'),
  {
    loading: () => null, // Don't show modal until loaded
  }
);
```

**Route-based splitting** (already handled by Next.js App Router):
```typescript
// app/(protected)/admin/franchisees/page.tsx
// app/(protected)/admin/suppliers/page.tsx
// Each route is automatically code-split by Next.js
```

---

### 5. Image Optimization Potential

**Current:**
Images are served directly without Next.js optimization.

**Example:**
```typescript
// Current approach
<img src={brand.logoUrl} alt={brand.name} width={100} height={100} />
```

**Solution - Use Next.js Image Component:**

```typescript
import Image from 'next/image';

<Image
  src={brand.logoUrl}
  alt={brand.name}
  width={100}
  height={100}
  priority={false} // Lazy load
  placeholder="blur" // Add blur placeholder
/>
```

**Configuration (already in next.config.ts):**
```typescript
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "**.r2.cloudflarestorage.com",
      },
    ],
  },
};
```

**Benefits:**
- Automatic image optimization (WebP, AVIF)
- Lazy loading
- Responsive images
- Blur placeholders
- Reduced bandwidth

---

### 6. Database Query Performance

**Current Issues:**
- No pagination limits on list queries
- Potential N+1 queries with relations
- No query result caching

**Solution - Implement Pagination:**

```typescript
// API route with pagination
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = (page - 1) * limit;

  const franchisees = await database
    .select()
    .from(franchisee)
    .limit(limit)
    .offset(offset)
    .orderBy(desc(franchisee.createdAt));

  const total = await database
    .select({ count: count() })
    .from(franchisee);

  return NextResponse.json({
    franchisees,
    pagination: {
      page,
      limit,
      total: total[0].count,
      totalPages: Math.ceil(total[0].count / limit),
    },
  });
}
```

**Client-side with TanStack Query:**

```typescript
function FranchiseeList() {
  const [page, setPage] = useState(1);
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["franchisees", page],
    queryFn: () => fetchFranchisees({ page, limit }),
  });

  return (
    <div>
      <FranchiseeList data={data.franchisees} />
      <Pagination
        page={page}
        totalPages={data.pagination.totalPages}
        onPageChange={setPage}
      />
    </div>
  );
}
```

---

## Next.js Specific Issues

### 1. No Server Actions Used

**Finding:**
Zero `"use server"` directives found in codebase.

**Impact:**
All mutations go through traditional API routes (POST/PATCH/DELETE endpoints), adding HTTP overhead and boilerplate.

**Consideration:**
API routes are a valid architectural choice and provide:
- Explicit HTTP method control
- Better separation from UI
- Easier to test independently
- Better CORS control

**Server Actions could provide:**
- Reduced boilerplate for mutations
- Form handling with progressive enhancement
- Better type safety
- Automatic CSRF protection

**Recommendation:**
Continue using API routes (current approach is valid), but consider Server Actions for:
- Simple form submissions
- Client-side mutations
- Progressive enhancement

---

### 2. Missing Data Fetching Patterns

**Current:**
Manual `fetch()` in `useEffect` throughout components.

**Best Practice:**
TanStack Query (already installed but unused in `src/queries/`).

**Recommendation:**
Migrate all manual fetch calls to TanStack Query:

**Phase 1 - Setup:**
1. Create `src/hooks/` directory structure
2. Create base query configuration
3. Set up QueryClient provider in layout

**Phase 2 - Migration:**
1. Create hooks for each data type (useFranchisees, useSuppliers, useCommissions, etc.)
2. Replace manual fetch calls in components
3. Remove 97+ `useEffect` data fetching patterns

**Phase 3 - Optimization:**
1. Configure stale times for different data types
2. Implement optimistic updates
3. Add query invalidation strategies

---

### 3. No Streaming for Large Datasets

**Finding:**
Large datasets loaded all at once without streaming.

**Recommendation:**
Implement streaming with `async/await` generators or pagination:

```typescript
// API route with streaming
export async function GET(request: NextRequest) {
  return new Response(
    new ReadableStream({
      async start(controller) {
        const batchSize = 100;
        let offset = 0;

        while (true) {
          const items = await database
            .select()
            .from(franchisee)
            .limit(batchSize)
            .offset(offset);

          if (items.length === 0) break;

          controller.enqueue(new TextEncoder().encode(JSON.stringify(items)));
          offset += batchSize;
        }

        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
      },
    }
  );
}
```

**Client-side streaming:**

```typescript
function FranchiseeList() {
  const [items, setItems] = useState<Franchisee[]>([]);

  useEffect(() => {
    const eventSource = new EventSource("/api/franchisees/stream");

    eventSource.onmessage = (event) => {
      const newItems = JSON.parse(event.data);
      setItems(prev => [...prev, ...newItems]);
    };

    return () => eventSource.close();
  }, []);

  return <FranchiseeTable items={items} />;
}
```

---

### 4. Middleware Matcher Too Broad

**Location:** `src/middleware.ts:48-60`

**Issue:**
Middleware runs on all routes except exclusions, including static assets.

```typescript
export const config = {
  matcher: [
    "/((?!api/auth|api/public|upload|_next/static|_next/image|favicon.ico|public).*)",
  ],
};
```

**Impact:**
Performance overhead on static assets and API routes that don't need auth checks.

**Recommendation:**
Narrow matcher to only protected routes:

```typescript
export const config = {
  matcher: [
    // Only run on protected routes
    "/dashboard/:path*",
    "/admin/:path*",
    // Exclude API routes (they handle their own auth)
  ],
};
```

---

## Additional Findings

### Unused Directories

1. **`src/queries/`** - Exists but contains no files
   - TanStack Query is installed but not implemented
   - Should be populated with query hooks or removed

2. **`src/fn/`** - Referenced in CLAUDE.md but doesn't exist in project
   - Documentation is outdated
   - Should be removed from docs if not needed

---

### Dependency Issues

**Installed but Underutilized:**

| Dependency | Install Status | Usage Status | Recommendation |
|-----------|----------------|----------------|----------------|
| `@tanstack/react-query` | ✅ Installed | ❌ Not Used | Implement for all data fetching |
| `@tanstack/react-router` | ✅ Installed | ❌ Not Used | Remove (using Next.js App Router) |
| `@tanstack/react-start` | ✅ Installed | ❌ Not Used | Remove (not needed) |
| `@hookform/resolvers` | ✅ Installed | ⚠️ Minimal | Use with all forms |
| `react-hook-form` | ✅ Installed | ⚠️ Minimal | Expand usage to all forms |

**Missing Libraries:**

1. **Error Boundary Components** - No graceful error handling
2. **Loading Skeletons** - Basic spinners only
3. **Retry Mechanisms** - Manual retry only
4. **Form Validation** - Zod installed but not consistently used
5. **Toast/Notification Library** - Sonner used but not consistently

---

### Database Schema Review

**Strengths:**
1. **Comprehensive enum types** - Proper status, role, and type enums
2. **Proper indexing strategy** - Indexes on foreign keys and frequently queried columns
3. **Relations defined with Drizzle** - Clear entity relationships
4. **Audit log table** - Comprehensive tracking of all sensitive actions
5. **History tables** - Track changes for important entities (franchisee_status_history, supplier_commission_history)
6. **Polymorphic associations** - Documents table supports multiple entity types
7. **JSONB columns** - Flexible storage for permissions, metadata, file mappings
8. **Module-level permissions** - Granular access control (view, edit, create, delete, approve)
9. **Timestamps** - Proper createdAt/updatedAt tracking
10. **Soft delete flags** - isActive flags for non-destructive deletions

**Concerns:**

1. **No soft delete pattern for all tables**
   - Only some tables have `isActive` flag
   - Some tables use hard deletes (cascade)
   - Recommendation: Add `deletedAt` timestamp to all tables

2. **Large audit logs could benefit from partitioning**
   - No table partitioning strategy
   - Query performance may degrade over time
   - Recommendation: Partition by month/year for large tables

3. **No database migration rollback strategy visible**
   - Drizzle migrations present but no rollback documentation
   - Recommendation: Document rollback procedures

4. **Some indexes could be composite**
   - Single column indexes where composite would help
   - Example: `(brandId, isActive)` instead of just `brandId`

---

## Recommended Action Plan

### Phase 1: Security (Week 1-2) - Critical Priority

**Immediate Actions (Week 1):**

1. **Rotate Secrets:**
   - [ ] Rotate `BETTER_AUTH_SECRET` immediately
   - [ ] Verify Google OAuth credentials are test credentials
   - [ ] Document secret rotation procedure

2. **Fix Critical Vulnerabilities:**
   - [ ] Implement mandatory `CRON_SECRET` check in production
   - [ ] Add proper webhook signature verification for all environments
   - [ ] Implement file magic number validation for uploads
   - [ ] Add pre-commit hooks for `.env` protection

3. **Hardening:**
   - [ ] Add rate limiting middleware
   - [ ] Implement CSRF token validation
   - [ ] Add input sanitization layer
   - [ ] Update `.env.example` with `CRON_SECRET`

**Documentation (Week 2):**

4. [ ] Create security documentation
   - [ ] Document authentication flow
   - [ ] Document authorization patterns
   - [ ] Create security checklist for developers
   - [ ] Document incident response procedures

---

### Phase 2: Code Deduplication (Week 2-3) - High Priority

**Week 2:**

1. **Create Shared Utilities:**
   - [ ] Create `src/lib/api-middleware.ts` with auth helpers
   - [ ] Create `src/lib/data-access-helpers.ts` with generic CRUD factories
   - [ ] Create `src/lib/formatters.ts` with shared formatting functions
   - [ ] Create `src/lib/validators.ts` with common validation logic

2. **Extract Currency/Date Formatting:**
   - [ ] Move `formatCurrency` to shared formatters
   - [ ] Move `formatDate` to shared formatters
   - [ ] Move `formatDateTime` to shared formatters
   - [ ] Move `formatPercentage` to shared formatters
   - [ ] Update all 14+ usages to use shared functions

**Week 3:**

3. **Refactor Data Access Layer:**
   - [ ] Refactor 8 `getById` functions to use generic factory
   - [ ] Refactor 8 `getActive` functions to use generic factory
   - [ ] Refactor 4 `isCodeUnique` functions to use generic factory
   - [ ] Refactor 4 `getStats` functions to use generic factory

4. **Update API Routes:**
   - [ ] Replace 100+ auth blocks with middleware helpers
   - [ ] Standardize error responses across all routes
   - [ ] Add consistent error codes

---

### Phase 3: Component Architecture (Week 3-4) - High Priority

**Week 3:**

1. **Break Down Oversized Components:**
   - [ ] Break down `franchisees/page.tsx` (1,780 lines)
   - [ ] Extract `useFranchiseeData()` hook
   - [ ] Extract `useFranchiseeFilters()` hook
   - [ ] Extract `FranchiseeList` component
   - [ ] Extract `FranchiseeForm` component
   - [ ] Extract `FranchiseeStatusChangeModal` component
   - [ ] Extract `FranchiseeDetailView` component

2. **Break Down Other Large Components:**
   - [ ] Refactor `suppliers/page.tsx` (1,319 lines)
   - [ ] Refactor `reports/page.tsx` (1,162 lines)
   - [ ] Refactor `reconciliation/page.tsx` (1,096 lines)

**Week 4:**

3. **Implement Compound Components:**
   - [ ] Create compound `FranchiseeCard` pattern
   - [ ] Create compound `SupplierCard` pattern
   - [ ] Create compound `CommissionCard` pattern

4. **Create Reusable Components:**
   - [ ] Create reusable `DataTable` component with sorting/pagination
   - [ ] Create reusable `FilterPanel` component
   - [ ] Create reusable `FormDialog` component
   - [ ] Create reusable `LoadingSkeleton` component

5. **Reduce Prop Drilling:**
   - [ ] Implement React Context for shared state
   - [ ] Create `FranchiseeProvider` for franchisee data
   - [ ] Create `DashboardProvider` for dashboard state

---

### Phase 4: Data Layer (Week 4-5) - High Priority

**Week 4:**

1. **TanStack Query Setup:**
   - [ ] Create `src/hooks/` directory structure
   - [ ] Set up QueryClient provider in root layout
   - [ ] Create base query configuration
   - [ ] Configure default stale times and retries

2. **Create Data Fetching Hooks:**
   - [ ] Create `useFranchisees()` hook
   - [ ] Create `useFranchisee(id)` hook
   - [ ] Create `useSuppliers()` hook
   - [ ] Create `useSuppliers(id)` hook
   - [ ] Create `useBrands()` hook
   - [ ] Create `useCommissions()` hook
   - [ ] Create `useSettlements()` hook
   - [ ] Create `useUsers()` hook
   - [ ] Create `useDocuments()` hook

3. **Create Mutation Hooks:**
   - [ ] Create `useCreateFranchisee()` mutation
   - [ ] Create `useUpdateFranchisee()` mutation
   - [ ] Create `useDeleteFranchisee()` mutation
   - [ ] Create similar mutations for all entities

**Week 5:**

4. **Migrate Components:**
   - [ ] Replace 97+ manual fetch calls with TanStack Query hooks
   - [ ] Remove all `useEffect` data fetching patterns
   - [ ] Implement optimistic updates
   - [ ] Add query invalidation strategies

5. **Cleanup:**
   - [ ] Remove or populate `src/queries/` directory
   - [ ] Remove unused TanStack Router and Start packages
   - [ ] Update documentation

---

### Phase 5: Performance (Week 5-6) - Medium Priority

**Week 5:**

1. **Implement Caching:**
   - [ ] Add Redis/Upstash for server-side caching
   - [ ] Configure cache headers for API routes
   - [ ] Set up TanStack Query caching with appropriate stale times
   - [ ] Implement cache invalidation strategy

2. **Optimize Re-renders:**
   - [ ] Add `React.memo` to list items
   - [ ] Implement `useReducer` for complex state
   - [ ] Separate state management from UI rendering
   - [ ] Add loading skeletons for perceived performance

**Week 6:**

3. **Implement Code Splitting:**
   - [ ] Add dynamic imports for heavy components
   - [ ] Dynamic import PDF generation components
   - [ ] Dynamic import chart libraries
   - [ ] Dynamic import modal dialogs

4. **Image & Asset Optimization:**
   - [ ] Replace `<img>` with Next.js `<Image>` component
   - [ ] Add blur placeholders for images
   - [ ] Optimize font loading (already using next/font/google)
   - [ ] Add CDN configuration for production

5. **Pagination & Streaming:**
   - [ ] Implement pagination on all list endpoints
   - [ ] Add pagination UI components
   - [ ] Consider streaming for very large datasets
   - [ ] Add infinite scroll where appropriate

---

### Phase 6: Testing & Documentation (Week 6-7) - Low Priority

**Week 6:**

1. **Expand Test Coverage:**
   - [ ] Add unit tests for utility functions
   - [ ] Add integration tests for API routes
   - [ ] Add component tests with React Testing Library
   - [ ] Add E2E tests with Playwright (already configured)

2. **Add Error Handling:**
   - [ ] Create Error Boundary components
   - [ ] Add error fallbacks for all routes
   - [ ] Implement error logging service
   - [ ] Add user-friendly error messages

**Week 7:**

3. **Documentation:**
   - [ ] Document API endpoints with OpenAPI/Swagger
   - [ ] Update CLAUDE.md with current architecture
   - [ ] Create component documentation with Storybook (optional)
   - [ ] Create development onboarding guide
   - [ ] Document deployment procedures

4. **Cleanup:**
   - [ ] Remove unused directories (`src/fn/`)
   - [ ] Remove unused dependencies
   - [ ] Update README with new patterns
   - [ ] Create changelog

---

## Final Scores

### Detailed Breakdown

| Category | Score | Notes |
|-----------|--------|-------|
| **Security** | 6/10 | Good foundation (Better Auth, RBAC, audit logs) but critical vulnerabilities need immediate fixing |
| **Maintainability** | 5/10 | Clean layered architecture hindered by severe duplication (1,000+ lines) and oversized components (1,780 lines) |
| **Performance** | 6/10 | Missed opportunities - no caching, manual fetching, no optimization |
| **Code Quality** | 5/10 | 1,780-line components, 97+ duplicated patterns, 14+ duplicated utilities |
| **Architecture** | 7/10 | Good layering and separation, but unused patterns (TanStack Query, queries/) and missing state management |
| **Type Safety** | 9/10 | Excellent TypeScript usage throughout, Drizzle provides type-safe queries |
| **Documentation** | 6/10 | Good docs in `/docs/` and `CLAUDE.md`, but some inconsistencies (missing `CRON_SECRET`, outdated `src/fn/`) |

### Overall Grade: 6/10

**Summary:** This is a solid production application with a clear architectural vision. The use of TypeScript, Drizzle ORM, Better Auth, and shadcn/ui demonstrates modern best practices. However, the codebase suffers from severe code duplication, oversized components, and missing modern React patterns.

**Estimated Effort:** 6-7 weeks for full remediation

**Priority Order:**
1. **Security** (Week 1-2) - Critical vulnerabilities must be fixed immediately
2. **Code Deduplication** (Week 2-3) - Significantly improves maintainability
3. **Component Architecture** (Week 3-4) - Reduces complexity and improves performance
4. **Data Layer** (Week 4-5) - TanStack Query migration provides massive benefits
5. **Performance** (Week 5-6) - Caching and optimization improve UX
6. **Testing & Documentation** (Week 6-7) - Ensures long-term maintainability

---

## Appendix

### File Statistics

| Metric | Count |
|---------|--------|
| Total TypeScript/TSX files | 184 |
| API route files | 77 |
| Component files | 59 |
| Client components (`"use client"`) | 48 (81%) |
| Server components | 11 (19%) |
| Data access files | 14 |
| Utility files | 15 |
| Total lines of code | ~30,000 (estimated) |
| Duplicated code lines | ~1,000+ (estimated) |

### Technology Matrix

| Layer | Technology | Status |
|--------|-------------|--------|
| Framework | Next.js 15 (App Router) | ✅ Latest, production-ready |
| UI Library | React 19 | ✅ Latest |
| Language | TypeScript 5.7.2 | ✅ Latest, strict mode |
| Database | PostgreSQL 17 + Drizzle ORM 0.44.7 | ✅ Type-safe, modern |
| Authentication | Better Auth 1.4.10 | ✅ Feature-rich, modern |
| Storage | AWS S3/Cloudflare R2 | ✅ Secure, scalable |
| Email | Resend 6.7.0 | ✅ Modern with webhooks |
| Styling | Tailwind CSS 3.4.17 + shadcn/ui | ✅ Consistent, accessible |
| Forms | React Hook Form 7.66.1 + Zod 4.1.12 | ⚠️ Installed but underutilized |
| Data Fetching | Manual fetch() | ❌ Should use TanStack Query |
| State Management | Local state only | ❌ No global state |
| Testing | Playwright 1.49.1 | ✅ E2E configured |
| Build Tool | Turbopack (dev) | ✅ Fast builds |

---

**Report Generated:** January 12, 2026
**Auditor:** Senior Lead Software Architect & Security Auditor
**Next Review:** After Phase 1 completion (2 weeks)
