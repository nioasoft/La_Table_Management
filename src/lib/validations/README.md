# Validation Schemas

This directory contains Zod validation schemas for the reports system and other application features.

## Usage Examples

### Basic Validation

```typescript
import { uuidSchema, periodKeySchema, paginationSchema } from "@/lib/validations/report-schemas";

// Validate UUID
const result = uuidSchema.safeParse("550e8400-e29b-41d4-a716-446655440000");
if (result.success) {
  console.log("Valid UUID:", result.data);
} else {
  console.log("Error:", result.error.errors[0].message); // "מזהה לא תקין"
}

// Validate period key
const periodResult = periodKeySchema.safeParse("2024-Q1");
if (!periodResult.success) {
  console.log("Invalid period format");
}

// Validate pagination
const pageResult = paginationSchema.parse({ page: 1, pageSize: 50 });
console.log(pageResult); // { page: 1, pageSize: 50 }
```

### Date Range Validation

```typescript
import { dateRangeSchema } from "@/lib/validations/report-schemas";

// Valid date range
const validRange = dateRangeSchema.parse({
  startDate: new Date("2024-01-01"),
  endDate: new Date("2024-12-31"),
});

// Invalid date range (startDate > endDate)
try {
  dateRangeSchema.parse({
    startDate: new Date("2024-12-31"),
    endDate: new Date("2024-01-01"),
  });
} catch (error) {
  console.log(error.errors[0].message); // "תאריך התחלה חייב להיות לפני או שווה לתאריך סיום"
}
```

### Report Filter Schemas

```typescript
import {
  commissionFiltersSchema,
  depositsFiltersSchema,
  unauthorizedSuppliersFiltersSchema
} from "@/lib/validations/report-schemas";

// Commission report filters
const filters = commissionFiltersSchema.parse({
  status: "approved",
  periodKey: "2024-Q1",
  minAmount: 100,
  maxAmount: 10000,
  startDate: new Date("2024-01-01"),
  endDate: new Date("2024-03-31"),
});

// Deposits report filters
const depositFilters = depositsFiltersSchema.parse({
  supplierId: "550e8400-e29b-41d4-a716-446655440000",
  depositType: "security",
  status: "active",
});

// Unauthorized suppliers filters
const unauthorizedFilters = unauthorizedSuppliersFiltersSchema.parse({
  franchiseeId: "550e8400-e29b-41d4-a716-446655440000",
  supplierName: "ספק לא מורשה",
  periodKey: "2024-Q2",
});
```

### Batch Operations

```typescript
import { batchCreateSchema, batchDeleteSchema } from "@/lib/validations/report-schemas";
import { z } from "zod";

// Create a batch schema for a specific item type
const itemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  amount: z.number().positive(),
});

const batchSchema = batchCreateSchema(itemSchema);

// Valid batch (1-100 items)
const result = batchSchema.parse({
  items: [
    { id: "550e8400-e29b-41d4-a716-446655440000", name: "Item 1", amount: 100 },
    { id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8", name: "Item 2", amount: 200 },
  ],
});

// Batch delete
const deleteResult = batchDeleteSchema.parse({
  ids: [
    "550e8400-e29b-41d4-a716-446655440000",
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  ],
});
```

### Export Requests

```typescript
import { exportRequestSchema } from "@/lib/validations/report-schemas";

// Valid export request
const exportReq = exportRequestSchema.parse({
  format: "xlsx",
  includeMetadata: true,
  filename: "דוח_עמלות_2024_Q1",
});

// With defaults
const defaultExport = exportRequestSchema.parse({ format: "xlsx" });
console.log(defaultExport); // { format: "xlsx", includeMetadata: true }
```

### Sort and Pagination

```typescript
import {
  createSortSchema,
  sortDirectionSchema,
  paginationSchema
} from "@/lib/validations/report-schemas";

// Create a sort schema for specific fields
const commissionSortSchema = createSortSchema([
  "supplierName",
  "franchiseeName",
  "amount",
  "createdAt",
] as const);

const sortParams = commissionSortSchema.parse({
  sortBy: "amount",
  sortDirection: "desc",
});

// Pagination with defaults
const page = paginationSchema.parse({});
console.log(page); // { page: 1, pageSize: 50 }
```

### API Route Usage

```typescript
import { NextRequest, NextResponse } from "next/server";
import { commissionFiltersSchema } from "@/lib/validations/report-schemas";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Convert searchParams to object
  const params = Object.fromEntries(searchParams.entries());

  // Validate filters
  const result = commissionFiltersSchema.safeParse(params);

  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid filters", details: result.error.errors },
      { status: 400 }
    );
  }

  const filters = result.data;

  // Use validated filters...
  const data = await fetchCommissions(filters);

  return NextResponse.json(data);
}
```

### TypeScript Type Inference

```typescript
import type {
  CommissionFilters,
  DepositsFilters,
  Pagination,
  UUID,
  PeriodKey
} from "@/lib/validations/report-schemas";

// Use inferred types in your functions
async function fetchCommissions(filters: CommissionFilters) {
  // filters is fully typed based on the schema
  const { status, periodKey, minAmount, maxAmount } = filters;
  // ...
}

// Use primitive types
function getReport(id: UUID, period: PeriodKey) {
  // id and period are validated string types
}
```

## Available Schemas

### Base Schemas
- `uuidSchema` - UUID validation
- `periodKeySchema` - Period key format (YYYY-Q[1-4] or YYYY-M[01-12])
- `paginationSchema` - Page number and page size
- `dateRangeSchema` - Start and end date validation
- `amountFilterSchema` - Min/max amount validation
- `sortDirectionSchema` - Ascending/descending sort

### Report Filter Schemas
- `commissionFiltersSchema` - Commission report filters
- `depositsFiltersSchema` - Deposits report filters
- `unauthorizedSuppliersFiltersSchema` - Unauthorized suppliers filters
- `varianceFiltersSchema` - Variance report filters
- `invoiceFiltersSchema` - Invoice report filters

### Batch Operations
- `batchCreateSchema(itemSchema)` - Generic batch create/update (max 100 items)
- `batchDeleteSchema` - Batch delete by IDs (max 100 items)

### Other Schemas
- `exportRequestSchema` - Export format and filename validation
- `createSortSchema(fields)` - Generic sortable fields schema

## Error Messages

All error messages are in Hebrew for consistency with the application's primary language. The schemas provide clear validation error messages that can be displayed directly to users.

## Notes

- The schemas use `z.coerce` for automatic type coercion where appropriate (numbers, dates)
- All optional fields use `.optional()` explicitly
- Defaults are set using `.default()` where applicable
- The schemas enforce business rules (e.g., date ranges, amount ranges, batch limits)
- Use `.safeParse()` when you want to handle validation errors gracefully
- Use `.parse()` when you want to throw on validation errors
