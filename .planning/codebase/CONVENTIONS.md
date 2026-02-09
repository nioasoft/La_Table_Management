# Coding Conventions

**Analysis Date:** 2026-02-09

## Naming Patterns

**Files:**
- Components: PascalCase (e.g., `StatusBadge.tsx`, `UserProfile.tsx`)
- Utilities/hooks: camelCase (e.g., `use-admin-auth.ts`, `report-utils.ts`)
- Data access: camelCase (e.g., `emailTemplates.ts`, `vatRates.ts`)
- API routes: camelCase in filenames (e.g., `route.ts` in directories like `supplier-files/route.ts`)
- Types/interfaces: Dedicated files typically named with entity name (e.g., `reconciliation-v2.ts`)

**Functions:**
- Regular functions: camelCase (e.g., `formatPercent()`, `calculateNetFromGross()`, `getEmailTemplates()`)
- React components: PascalCase (e.g., `StatusBadge()`, `Button()`)
- Custom hooks: camelCase with `use` prefix (e.g., `useAdminAuth()`, `useSession()`)
- Async data fetchers: camelCase, verb-first (e.g., `getEmailTemplateById()`, `createSupplierFileUpload()`)

**Variables:**
- Regular variables: camelCase (e.g., `userRole`, `supplierId`, `processingResult`)
- Constants: UPPER_SNAKE_CASE (e.g., `ISRAEL_VAT_RATE = 0.18`, `DEFAULT_PAGE_SIZE`)
- Boolean variables: prefixed with `is`, `has`, `can` (e.g., `isAuthorized`, `isPending`, `hasNextPage`)
- State variables (React): camelCase (e.g., `isLoading`, `searchTerm`)

**Types:**
- Interfaces: PascalCase (e.g., `UseAdminAuthOptions`, `StatusBadgeProps`, `ReconciliationEntry`)
- Type aliases: PascalCase (e.g., `BadgeVariant`, `SortDirection`, `EmailStatus`)
- Database schema types: PascalCase inferred from Drizzle (e.g., `EmailTemplate`, `UserRole`)
- Enum values: snake_case or camelCase depending on context (status values use snake_case: `auto_approved`, `needs_review`)

## Code Style

**Formatting:**
- No explicit formatter config detected (no .eslintrc, .prettierrc)
- ESLint: Uses `eslint-config-next/core-web-vitals` via `eslint.config.mjs`
- Line length: Inferred ~90-100 characters based on code samples
- Indentation: 2 spaces (standard Next.js)

**Linting:**
- Tool: ESLint 9.x with Next.js core web vitals config
- Config file: `eslint.config.mjs`
- Run command: `npm run lint` targets `src` directory
- Ignored directories: `.next/**`, `out/**`, `build/**`, `node_modules/**`

**Prettier:**
- Config: Not explicitly defined (relies on ESLint defaults)
- `.prettierignore` exists: excludes `build/`, `public/`, `pnpm-lock.yaml`, `routeTree.gen.ts`

## Import Organization

**Order:**
1. External dependencies (React, Next.js, third-party libraries)
2. Internal utilities and helpers (`@/lib/`, `@/utils/`)
3. Database and data access (`@/db/`, `@/data-access/`)
4. Components (`@/components/`)
5. Hooks (`@/hooks/`, `@/queries/`)
6. Types (`@/types/`)

**Example:**
```typescript
import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { formatDateAsLocal } from "@/lib/date-utils";
import { database } from "@/db";
import { emailTemplate } from "@/db/schema";
import { Card } from "@/components/ui/card";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import type { EmailTemplate } from "@/db/schema";
```

**Path Aliases:**
- `@/*`: Maps to `./src/*` (primary alias, preferred)
- `~/*`: Maps to `./src/*` (secondary alias, available but less common)

Use `@/` consistently for imports.

## Error Handling

**Patterns:**
- API routes: Try-catch with specific error logging to console
- Client components: Use toast notifications for user-facing errors with Hebrew messages
- Data access functions: Return `null` for not-found cases, throw errors for unexpected failures
- Validation: Zod schemas with Hebrew error messages

**Example:**
```typescript
// API routes
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    // ... handler logic
  } catch (error) {
    console.error("Error fetching data:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Client-side error handling
try {
  await saveData(data);
  toast.success("הנתונים נשמרו בהצלחה");
} catch (error) {
  toast.error("שגיאה בשמירת הנתונים");
  console.error("Failed to save data:", error);
}
```

## Logging

**Framework:** `console` object (standard browser/Node.js logging)

**Patterns:**
- `console.error()` in API routes and server-side operations for failures
- `console.log()` rarely used (prefer logging only errors and critical debug info)
- Error logging format: `"[Context/Operation]: [description]"` (e.g., `"Error fetching supplier files:"`)
- No structured logging library detected

**Example:**
```typescript
console.error("Error fetching supplier files:", error);
console.error("Error calculating commissions:", error);
```

## Comments

**When to Comment:**
- Complex algorithms or non-obvious logic (e.g., VAT calculations, date timezone handling)
- Public API endpoints to document request/response format
- Data validation rules or constraints
- Business logic that isn't self-evident

**JSDoc/TSDoc:**
- Used consistently for public functions and hooks
- Format: English language, descriptive comments
- Include `@param`, `@returns`, `@example` tags for complex functions
- Status configuration objects and utility functions are documented

**Example:**
```typescript
/**
 * Custom hook for admin authentication and authorization.
 *
 * Checks if user has admin or super_user role and handles redirects:
 * - Redirects to sign-in if no session
 * - Redirects to dashboard if user lacks required permissions
 *
 * @param options.redirectPath - Path to redirect unauthorized users (default: '/dashboard')
 * @param options.requireSuperUser - If true, only super_user role is authorized
 * @returns Session data, loading state, role checks, and authorization status
 *
 * @example
 * ```tsx
 * const { isAuthorized, isPending } = useAdminAuth({ requireSuperUser: true });
 * ```
 */
export function useAdminAuth(options: UseAdminAuthOptions = {}): UseAdminAuthReturn {
```

## Function Design

**Size:** Functions kept focused and under 100 lines typically

**Parameters:**
- Explicit parameters for public functions
- Destructured object parameters for multiple related options
- Default values used for optional parameters (e.g., `ISRAEL_VAT_RATE` in calculation functions)
- Type annotations required (strict TypeScript)

**Return Values:**
- Explicit return types on function signatures
- Async data functions return `Promise<T | null>` for single items, `Promise<T[]>` for collections
- State hooks return destructured object with multiple values

**Example:**
```typescript
export function normalizePaginationParams(params: PaginationParams): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, params.limit ?? DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export async function getEmailTemplateById(id: string): Promise<EmailTemplate | null> {
  const results = (await database
    .select()
    .from(emailTemplate)
    .where(eq(emailTemplate.id, id))
    .limit(1)) as unknown as EmailTemplate[];
  return results[0] || null;
}
```

## Module Design

**Exports:**
- Named exports preferred (e.g., `export function formatPercent()`, `export const Button`)
- Default exports used for React page components
- Barrel files (index files) used to re-export from subdirectories for backwards compatibility

**Example:**
```typescript
// src/components/sidebar.tsx - Barrel file
export { Sidebar, MobileSidebarToggle, SidebarProvider, useSidebar } from "./sidebar/index";

// src/components/ui/button.tsx - Named exports
export { Button, buttonVariants };
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}
```

## Validation & Type Safety

**Zod Schemas:**
- All validation schemas in `src/lib/validations/` directory
- Schema organization: Grouped by domain (e.g., `report-schemas.ts`)
- Error messages in Hebrew for user-facing validation
- Schema composition with `.merge()` and `.refine()` for complex validations
- Type exports generated from Zod schemas using `z.infer<typeof schema>`

**TypeScript:**
- Strict mode enabled in `tsconfig.json`
- No `any` types allowed
- Generics used extensively (e.g., `Record<string, StatusConfig>`, `z.ZodTypeAny`)
- Type assertions used sparingly and with comments when necessary

**Example:**
```typescript
// Validation schema with composition
export const commissionFiltersSchema = z
  .object({
    supplierId: uuidSchema.optional(),
    status: z.enum(["pending", "calculated", "approved", "paid", "cancelled"]).optional(),
  })
  .merge(dateRangeSchema)
  .merge(amountFilterSchema);

// Type inference
export type CommissionFilters = z.infer<typeof commissionFiltersSchema>;
```

## API Routes Authentication

**CRITICAL PATTERN:**
Always use `@/lib/api-middleware` for API route authentication, NOT direct auth imports.

```typescript
// ✅ CORRECT
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  // ... rest of handler
}

// ❌ WRONG - Do NOT use these patterns
import { auth } from "@/lib/auth";      // Path doesn't exist
import { auth } from "@/utils/auth";    // Use api-middleware instead
```

Available middleware functions:
- `requireAuth` - Any authenticated user
- `requireAdminOrSuperUser` - Admin or Super User only
- `requireSuperUser` - Super User only

## Component Structure

**Client Components:**
- Mark with `"use client"` directive when needed
- Include loading and error states
- Hebrew user-facing messages in toast notifications
- Props interfaces named with `Props` suffix (e.g., `StatusBadgeProps`)

**Example:**
```typescript
"use client";

interface StatusBadgeProps {
  status: ReconciliationComparisonStatus | ReconciliationSessionStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || { label: status, variant: "secondary" as const };
  return <Badge variant={config.variant} className={cn(className)}>{config.label}</Badge>;
}
```

## Data Access Layer

**Pattern:**
- All database queries isolated in `src/data-access/` directory
- Function naming: verb-first (get, create, update, delete)
- Functions are async and return typed results
- Database imports: `import { database } from "@/db"` and schema from `@/db/schema`

**Example from** `src/data-access/emailTemplates.ts`:
```typescript
export async function getEmailTemplates(): Promise<EmailTemplate[]> {
  return database
    .select()
    .from(emailTemplate)
    .orderBy(desc(emailTemplate.createdAt)) as unknown as Promise<EmailTemplate[]>;
}
```

---

*Convention analysis: 2026-02-09*
