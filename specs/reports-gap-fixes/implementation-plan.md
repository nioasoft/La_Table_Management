# Implementation Plan: Reports System Gap Fixes

## Overview

Fix gaps identified by code review comparing the original plan to actual implementation. Focus on critical missing features first, then medium priority improvements.

---

## Phase 1: Invoice Report (Critical)

Create the missing invoice report page using existing shared components.

### Tasks

- [ ] Create invoice report page at `src/app/(protected)/admin/reports/invoice/page.tsx`
- [ ] Add invoice report to sidebar navigation in `src/components/sidebar.tsx`
- [ ] Add invoice report card to reports hub at `src/app/(protected)/admin/reports/page.tsx`
- [ ] Create API endpoint at `src/app/api/reports/invoice/route.ts`
- [ ] Create data access function at `src/data-access/invoice-report.ts`

### Technical Details

**Page Structure (copy pattern from commissions report):**
```tsx
// src/app/(protected)/admin/reports/invoice/page.tsx
import { ReportLayout, ReportSummaryCards, ReportDataTable } from "@/components/reports";

// Columns for invoice table
const invoiceColumns: ColumnDef<InvoiceEntry>[] = [
  { id: "invoiceNumber", header: "מספר חשבונית", accessorKey: "invoiceNumber" },
  { id: "franchiseeName", header: "זכיין", accessorKey: "franchiseeName" },
  { id: "brandNameHe", header: "מותג", accessorKey: "brandNameHe" },
  { id: "amount", header: "סכום", accessor: (row) => formatCurrency(row.amount) },
  { id: "status", header: "סטטוס", cell: (row) => <Badge>...</Badge> },
  { id: "dueDate", header: "תאריך יעד", accessor: (row) => formatDateHe(row.dueDate) },
];
```

**Sidebar Entry (add to reports children):**
```tsx
{
  label: he.sidebar.subNavigation.invoiceReport,
  href: "/admin/reports/invoice",
  icon: <FileText className="h-4 w-4" />
}
```

**Reports Hub Card:**
```tsx
{
  title: "דוח חשבוניות",
  description: "מעקב חשבוניות ותשלומים לפי זכיין ומותג",
  href: "/admin/reports/invoice",
  icon: <FileText className="h-6 w-6" />,
  status: "active",
  color: "text-indigo-600",
}
```

**API Route Pattern:**
```typescript
// src/app/api/reports/invoice/route.ts
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  // ... filters and data fetching
}
```

**Reference existing invoice page:**
- Old location: `src/app/(protected)/admin/commissions/invoice/page.tsx`
- Copy and adapt to use shared components

---

## Phase 2: Deposits Report Improvements (Critical)

Improve deposits report to show supplier dimension and chronological running balance.

### Tasks

- [ ] Investigate schema to determine if supplier info exists in adjustment metadata
- [ ] Update `src/data-access/deposits.ts` to extract supplier from metadata if available
- [ ] Add "By Supplier" tab to deposits report if supplier data exists
- [ ] Improve running balance calculation to be chronological
- [ ] Add explanatory text if supplier dimension is not available

### Technical Details

**Schema Investigation:**
```sql
-- Check if adjustments have supplier info in metadata
SELECT DISTINCT jsonb_object_keys(metadata)
FROM adjustment
WHERE adjustment_type = 'deposit'
AND metadata IS NOT NULL;

-- Check for supplier references
SELECT metadata->>'supplierId', metadata->>'supplierName'
FROM adjustment
WHERE adjustment_type = 'deposit'
LIMIT 10;
```

**Chronological Running Balance:**
```typescript
// Sort by date first, then calculate cumulative sum
const sortedDeposits = [...deposits].sort((a, b) =>
  new Date(a.effectiveDate || a.createdAt).getTime() -
  new Date(b.effectiveDate || b.createdAt).getTime()
);

let runningTotal = 0;
const depositsWithBalance = sortedDeposits.map(d => ({
  ...d,
  runningBalance: (runningTotal += d.amount)
}));
```

**If Supplier Data Available, Add Interface:**
```typescript
interface DepositSummaryBySupplier {
  supplierId: string;
  supplierName: string;
  franchiseeId: string;
  franchiseeName: string;
  totalDeposits: number;
  depositCount: number;
  runningBalance: number;
}
```

---

## Phase 3: Excel Export for New Reports (Medium)

Add Excel export functionality to unauthorized suppliers and deposits reports.

### Tasks

- [ ] Create export endpoint at `src/app/api/reports/unauthorized/export/route.ts`
- [ ] Create export endpoint at `src/app/api/reports/deposits/export/route.ts`
- [ ] Add ReportExportButton to unauthorized suppliers page
- [ ] Add ReportExportButton to deposits page

### Technical Details

**Export Endpoint Pattern (from commissions):**
```typescript
// src/app/api/reports/unauthorized/export/route.ts
import ExcelJS from "exceljs";

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("ספקים לא מורשים");

  // RTL settings
  worksheet.views = [{ rightToLeft: true }];

  // Headers
  worksheet.columns = [
    { header: "שם ספק (BKMV)", key: "bkmvName", width: 30 },
    { header: "סכום כולל", key: "totalAmount", width: 15 },
    { header: "עסקאות", key: "transactionCount", width: 10 },
    { header: "זכיינים", key: "franchiseeCount", width: 10 },
    { header: "קבצים", key: "fileCount", width: 10 },
  ];

  // Data rows
  report.suppliers.forEach(s => {
    worksheet.addRow({
      bkmvName: s.bkmvName,
      totalAmount: s.totalAmount,
      transactionCount: s.transactionCount,
      franchiseeCount: s.franchisees.length,
      fileCount: s.fileCount,
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="unauthorized-suppliers-${Date.now()}.xlsx"`,
    },
  });
}
```

**Add Export Button to Pages:**
```tsx
// In ReportLayout actions prop
actions={
  <ReportExportButton
    endpoints={{
      excel: "/api/reports/unauthorized/export",
    }}
    queryString={buildQueryString()}
    reportType="unauthorized"
    disabled={!report}
  />
}
```

---

## Phase 4: Navigation Cleanup (Medium)

Set up redirects from old report paths and ensure clean navigation.

### Tasks

- [ ] Add redirects in `next.config.ts` (or `next.config.js`)
- [ ] Verify all old paths redirect correctly
- [ ] Update any internal links that still point to old paths

### Technical Details

**next.config.ts Redirects:**
```typescript
const nextConfig = {
  // ... existing config
  async redirects() {
    return [
      {
        source: '/admin/commissions/report',
        destination: '/admin/reports/commissions',
        permanent: true,
      },
      {
        source: '/admin/commissions/variance',
        destination: '/admin/reports/variance',
        permanent: true,
      },
      {
        source: '/admin/commissions/invoice',
        destination: '/admin/reports/invoice',
        permanent: true,
      },
      {
        source: '/admin/commissions/brand',
        destination: '/admin/reports/commissions',
        permanent: true,
      },
      {
        source: '/admin/commissions/supplier',
        destination: '/admin/reports/commissions',
        permanent: true,
      },
      {
        source: '/admin/commissions/franchisee',
        destination: '/admin/reports/commissions',
        permanent: true,
      },
    ];
  },
};
```

**Verification Commands:**
```bash
# Test redirects after implementation
curl -I http://localhost:3000/admin/commissions/report
# Should return 308 Permanent Redirect to /admin/reports/commissions
```

---

## Phase 5: Caching for Filter Options (Medium)

Add caching to reduce database queries for frequently accessed filter options.

### Tasks

- [ ] Add `unstable_cache` to `getUnauthorizedSuppliersFilterOptions` in `src/data-access/unauthorized-suppliers.ts`
- [ ] Add `unstable_cache` to `getDepositsFilterOptions` in `src/data-access/deposits.ts`
- [ ] Add `unstable_cache` to `getAllBrands`, `getActiveSuppliers`, `getAllFranchisees` in `src/data-access/reports.ts`

### Technical Details

**Caching Pattern:**
```typescript
import { unstable_cache } from "next/cache";

// Cached version with 5 minute TTL
export const getCachedFilterOptions = unstable_cache(
  async () => {
    const [brands, franchisees] = await Promise.all([
      database
        .select({ id: brand.id, nameHe: brand.nameHe, nameEn: brand.nameEn })
        .from(brand)
        .where(eq(brand.isActive, true)),
      database
        .select({
          id: franchisee.id,
          name: franchisee.name,
          brandId: franchisee.brandId,
        })
        .from(franchisee)
        .where(eq(franchisee.isActive, true)),
    ]);
    return { brands, franchisees };
  },
  ["filter-options"], // cache key
  { revalidate: 300 }  // 5 minutes
);

// Update function calls to use cached version
export async function getDepositsFilterOptions() {
  return getCachedFilterOptions();
}
```

---

## Phase 6: Optional Improvements (Low Priority)

Nice-to-have improvements that can be done later.

### Tasks

- [ ] Create `src/components/ui/multi-select.tsx` component
- [ ] Move `brandId` filter to SQL in `src/data-access/unauthorized-suppliers.ts`
- [ ] Move `brandId` filter to SQL in `src/data-access/deposits.ts`
- [ ] Remove unused `Badge` import from `src/lib/report-utils.ts`

### Technical Details

**SQL Filter for brandId (unauthorized-suppliers.ts):**
```typescript
// Instead of filtering in JavaScript after query:
// const filteredFiles = filters.brandId ? files.filter(f => f.brandId === filters.brandId) : files;

// Add to SQL WHERE clause:
if (filters.brandId) {
  conditions.push(eq(franchisee.brandId, filters.brandId));
}
// And use INNER JOIN instead of LEFT JOIN for franchisee/brand
```

**Multi-Select Component (if needed later):**
```tsx
// Based on shadcn/ui patterns
interface MultiSelectProps {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}
```

---

## Verification Checklist

After implementation, verify:

- [ ] Invoice report accessible at `/admin/reports/invoice`
- [ ] Invoice report appears in sidebar and reports hub
- [ ] Invoice report has working filters and pagination
- [ ] Deposits report shows improved running balance
- [ ] Unauthorized suppliers report has Excel export
- [ ] Deposits report has Excel export
- [ ] Old URLs redirect to new locations (test with curl -I)
- [ ] Filter options are cached (check server logs)
- [ ] All reports load in under 2 seconds
