# Testing Patterns

**Analysis Date:** 2026-02-09

## Test Framework

**Runner:**
- Vitest 4.0.18
- Config: `vitest.config.ts`
- Test environment: Node.js (not browser-based for unit tests)

**Assertion Library:**
- Vitest built-in expect API (compatible with Jest)

**Run Commands:**
```bash
npm run test                # Run all tests once
npm run test:watch         # Watch mode for development
npm run test:coverage      # Generate coverage report
```

## Test File Organization

**Location:**
- Unit tests: `src/__tests__/` directory (co-located by domain)
- E2E tests: `tests/` directory (separate from source)

**Naming:**
- Unit tests: `*.test.ts` (e.g., `report-utils.test.ts`, `pagination.test.ts`)
- E2E tests: `*.spec.ts` (e.g., `public-upload.spec.ts`)

**Structure:**
```
src/
├── __tests__/
│   ├── lib/
│   │   ├── report-utils.test.ts
│   │   ├── pagination.test.ts
│   │   ├── file-processor.test.ts
│   │   └── validations/
│   │       └── report-schemas.test.ts
│
tests/
└── public-upload.spec.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect } from "vitest";

describe("functionName", () => {
  describe("specific behavior context", () => {
    it("should do X when given Y", () => {
      const result = functionUnderTest(input);
      expect(result).toBe(expectedValue);
    });

    it("handles edge case Z", () => {
      expect(functionUnderTest(edgeInput)).toEqual(expectedResult);
    });
  });
});
```

**Patterns:**
- Sections separated by `describe` blocks for logical grouping
- Multi-level nesting for related tests (optional, but used for organization)
- Comment separators (`// ============`) for major test sections (see report-utils.test.ts)
- One assertion per `it` block typically, multiple assertions acceptable for related checks

**Example from** `src/__tests__/lib/report-utils.test.ts`:
```typescript
describe("formatPercent", () => {
  it("formats positive numbers as percentages", () => {
    expect(formatPercent(10)).toBe("10.00%");
    expect(formatPercent(5.5)).toBe("5.50%");
  });

  it("handles null value", () => {
    expect(formatPercent(null)).toBe("0.00%");
  });

  it("maintains precision to 2 decimal places", () => {
    expect(formatPercent(3.14159)).toBe("3.14%");
    expect(formatPercent(3.145)).toBe("3.15%"); // Rounding
  });
});
```

## Mocking

**Framework:** Vitest built-in mocking (vi module, though not explicitly used in sample tests)

**Patterns:**
- Limited mocking in visible test files - most tests are unit tests of pure functions
- No spy/mock examples detected in provided test samples
- Validation schemas tested directly without mocking dependencies

**What to Mock:**
- External API calls (fetch, HTTP requests)
- Database queries (wrap in abstraction functions before testing)
- Authentication/authorization checks in API routes
- File system operations

**What NOT to Mock:**
- Pure utility functions (formatters, validators, calculators)
- Zod schemas and validation logic
- Pagination and sorting utilities
- Mathematical calculations

**Example pattern for API routes (inferred from code structure):**
```typescript
// In tests, API route mocking would likely use:
// - Vitest's vi.mock() for @/lib/api-middleware
// - Mock NextRequest/NextResponse objects
// - Mock database functions from @/data-access/
```

## Fixtures and Factories

**Test Data:**
- Inline test data creation (no factory pattern detected)
- Explicit test data defined within each test
- Arrays of sample objects for batch testing

**Example from** `src/__tests__/lib/report-utils.test.ts`:
```typescript
describe("sortData", () => {
  const testData: TestItem[] = [
    { name: "Charlie", amount: 300 },
    { name: "Alice", amount: 100 },
    { name: "Bob", amount: 200 },
  ];

  it("sorts by name ascending", () => {
    const result = sortData(testData, { column: "name", direction: "asc" });
    expect(result[0].name).toBe("Alice");
  });
});
```

**Location:**
- Test data defined within `describe` blocks or individual `it` blocks
- No separate fixtures directory detected
- Constants reused across tests in same file

## Coverage

**Requirements:**
- Coverage configuration present in `vitest.config.ts`
- Targeted coverage for: validations, utilities, and core business logic
- No hard coverage threshold enforced (coverage recommended for specific modules)

**Target Coverage Modules:**
- `src/lib/validations/**/*.ts` - Schema validation (critical)
- `src/lib/pagination.ts` - Pagination logic
- `src/lib/report-utils.ts` - Report formatting and utilities
- `src/lib/file-processor.ts` - VAT calculations and file processing

**View Coverage:**
```bash
npm run test:coverage     # Generates coverage report
# Output: HTML report (check console for path), text summary, JSON for CI
```

**Coverage Config (vitest.config.ts):**
```typescript
coverage: {
  provider: "v8",
  reporter: ["text", "json", "html"],
  include: [
    "src/lib/validations/**/*.ts",
    "src/lib/pagination.ts",
    "src/lib/report-utils.ts",
    "src/lib/file-processor.ts",
  ],
}
```

## Test Types

**Unit Tests:**
- Scope: Individual utility functions, calculations, formatting
- Approach: Pure function testing with various inputs (normal, edge cases, null/undefined)
- Example files: `pagination.test.ts`, `file-processor.test.ts`, `report-utils.test.ts`
- Coverage: Comprehensive (happy path, edge cases, error conditions)

**Integration Tests:**
- Scope: API endpoints with database and authentication
- Approach: Test data access layer functions with real or mocked database
- Example pattern: Tests would import data-access functions and test against test database
- Not extensively visible in provided samples (likely exists in API route tests)

**E2E Tests:**
- Framework: Playwright 1.49.1
- Config: `playwright.config.ts`
- Run command: `npm run test:e2e`
- Scope: Full application workflows (e.g., upload page validation)
- Example: `tests/public-upload.spec.ts` tests file upload page accessibility

**E2E Configuration:**
```typescript
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --port 3001",
    url: "http://localhost:3001",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
```

## Common Patterns

**Async Testing:**
- Async functions tested with `async/await` in `it` blocks
- Vitest automatically waits for promise resolution
- Example: Data access functions that return `Promise<T>`

```typescript
it("returns email template when found", async () => {
  const template = await getEmailTemplateById("valid-id");
  expect(template).toBeDefined();
  expect(template?.id).toBe("valid-id");
});
```

**Error Testing:**
- Null/undefined handling tested explicitly
- Error states checked with `.toThrow()` matcher (for functions that throw)
- Return value validation for error conditions (null returns on not found)

**Example from** `src/__tests__/lib/pagination.test.ts`:
```typescript
it("enforces minimum page of 1 for zero", () => {
  const result = normalizePaginationParams({ page: 0 });
  expect(result.page).toBe(1);
});

it("enforces minimum page of 1 for negative values", () => {
  expect(normalizePaginationParams({ page: -1 }).page).toBe(1);
  expect(normalizePaginationParams({ page: -100 }).page).toBe(1);
});
```

**Null/Undefined Handling:**
```typescript
it("handles null date", () => {
  expect(formatDateHe(null)).toBe("-");
});

it("handles undefined date", () => {
  expect(formatDateHe(undefined)).toBe("-");
});

it("handles empty string", () => {
  expect(formatDateHe("")).toBe("-");
});
```

**Boundary Testing:**
```typescript
it("calculates correct values for first page", () => {
  const result = calculatePagination({ page: 1, pageSize: 10, total: 95 });
  expect(result.totalPages).toBe(10);
  expect(result.startIndex).toBe(0);
  expect(result.hasNextPage).toBe(true);
  expect(result.hasPrevPage).toBe(false);
});

it("handles single page", () => {
  const result = calculatePagination({ page: 1, pageSize: 10, total: 5 });
  expect(result.totalPages).toBe(1);
  expect(result.hasNextPage).toBe(false);
});
```

**Immutability Verification:**
```typescript
it("does not mutate original array", () => {
  const original = [...testData];
  sortData(testData, sortConfig);
  expect(testData).toEqual(original);
});
```

## Validation Testing

**Schema Testing Pattern:**
- Schemas tested with valid and invalid inputs
- Error messages validated (Hebrew localization)
- Compose validation with `.merge()` and `.refine()` tested for constraint enforcement

**Example (inferred from** `src/lib/validations/report-schemas.ts`**):
```typescript
describe("commissionFiltersSchema", () => {
  it("validates valid commission filter", () => {
    const result = commissionFiltersSchema.safeParse({
      supplierId: "valid-uuid",
      status: "approved",
      minAmount: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = commissionFiltersSchema.safeParse({
      status: "invalid",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("סטטוס לא תקין");
  });
});
```

## Test Quality Standards

**From observed test files:**
- Descriptive test names that explain the behavior being tested
- Clear input → assertion relationships
- Edge cases covered (null, empty, boundary values, very large values)
- Multiple assertions grouped logically within single tests when checking related properties
- Test data that matches real domain (e.g., amounts, dates, enums match business logic)
- Comments organizing test sections by feature/concern

---

*Testing analysis: 2026-02-09*
