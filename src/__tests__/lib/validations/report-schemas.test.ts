import { describe, it, expect } from "vitest";
import {
  uuidSchema,
  periodKeySchema,
  paginationSchema,
  dateRangeSchema,
  amountFilterSchema,
  commissionFiltersSchema,
  depositsFiltersSchema,
  unauthorizedSuppliersFiltersSchema,
  varianceFiltersSchema,
  varianceReportApiFiltersSchema,
  invoiceFiltersSchema,
  batchCreateSchema,
  batchDeleteSchema,
  exportRequestSchema,
  sortDirectionSchema,
  createSortSchema,
} from "@/lib/validations/report-schemas";
import { z } from "zod";

// ============================================================================
// UUID Schema Tests
// ============================================================================

describe("uuidSchema", () => {
  it("accepts valid UUIDs", () => {
    const validUuids = [
      "123e4567-e89b-12d3-a456-426614174000",
      "550e8400-e29b-41d4-a716-446655440000",
      "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    ];

    validUuids.forEach((uuid) => {
      const result = uuidSchema.safeParse(uuid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(uuid);
      }
    });
  });

  it("rejects invalid UUIDs", () => {
    const invalidUuids = [
      "",
      "not-a-uuid",
      "123e4567-e89b-12d3-a456", // Too short
      "123e4567-e89b-12d3-a456-4266141740001", // Too long
      "123e4567-e89b-12d3-a456-42661417400g", // Invalid character
      "123e4567e89b12d3a456426614174000", // Missing dashes
    ];

    invalidUuids.forEach((uuid) => {
      const result = uuidSchema.safeParse(uuid);
      expect(result.success).toBe(false);
    });
  });

  it("returns Hebrew error message for invalid UUID", () => {
    const result = uuidSchema.safeParse("invalid");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("לא תקין");
    }
  });
});

// ============================================================================
// Period Key Schema Tests
// ============================================================================

describe("periodKeySchema", () => {
  describe("quarterly format (YYYY-Q[1-4])", () => {
    it("accepts valid quarterly period keys", () => {
      const validQuarters = ["2024-Q1", "2024-Q2", "2024-Q3", "2024-Q4", "2023-Q1", "2025-Q4"];

      validQuarters.forEach((key) => {
        const result = periodKeySchema.safeParse(key);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(key);
        }
      });
    });

    it("rejects invalid quarterly period keys", () => {
      const invalidQuarters = [
        "2024-Q0", // Q0 is invalid
        "2024-Q5", // Q5 is invalid
        "2024-Q", // Missing quarter number
        "2024Q1", // Missing dash
        "24-Q1", // Short year
      ];

      invalidQuarters.forEach((key) => {
        const result = periodKeySchema.safeParse(key);
        expect(result.success).toBe(false);
      });
    });
  });

  describe("monthly format (YYYY-M[01-12])", () => {
    it("accepts valid monthly period keys", () => {
      const validMonths = [
        "2024-M01",
        "2024-M02",
        "2024-M03",
        "2024-M04",
        "2024-M05",
        "2024-M06",
        "2024-M07",
        "2024-M08",
        "2024-M09",
        "2024-M10",
        "2024-M11",
        "2024-M12",
      ];

      validMonths.forEach((key) => {
        const result = periodKeySchema.safeParse(key);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(key);
        }
      });
    });

    it("rejects invalid monthly period keys", () => {
      const invalidMonths = [
        "2024-M00", // M00 is invalid
        "2024-M13", // M13 is invalid
        "2024-M1", // Single digit without leading zero
        "2024-M", // Missing month number
        "2024M01", // Missing dash
      ];

      invalidMonths.forEach((key) => {
        const result = periodKeySchema.safeParse(key);
        expect(result.success).toBe(false);
      });
    });
  });

  it("rejects non-string values", () => {
    const result = periodKeySchema.safeParse(2024);
    expect(result.success).toBe(false);
  });

  it("returns Hebrew error message for invalid format", () => {
    const result = periodKeySchema.safeParse("invalid-format");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("פורמט מפתח תקופה לא תקין");
    }
  });
});

// ============================================================================
// Pagination Schema Tests
// ============================================================================

describe("paginationSchema", () => {
  it("accepts valid pagination parameters", () => {
    const result = paginationSchema.safeParse({ page: 1, pageSize: 50 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(50);
    }
  });

  it("uses default values when not provided", () => {
    const result = paginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(50);
    }
  });

  it("coerces string numbers to integers", () => {
    const result = paginationSchema.safeParse({ page: "5", pageSize: "25" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(5);
      expect(result.data.pageSize).toBe(25);
    }
  });

  it("rejects negative page number", () => {
    const result = paginationSchema.safeParse({ page: -1, pageSize: 50 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("חיובי");
    }
  });

  it("rejects zero page number", () => {
    const result = paginationSchema.safeParse({ page: 0, pageSize: 50 });
    expect(result.success).toBe(false);
  });

  it("rejects pageSize greater than 100", () => {
    const result = paginationSchema.safeParse({ page: 1, pageSize: 101 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("100");
    }
  });

  it("accepts pageSize of exactly 100", () => {
    const result = paginationSchema.safeParse({ page: 1, pageSize: 100 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pageSize).toBe(100);
    }
  });

  it("rejects non-integer values", () => {
    const result = paginationSchema.safeParse({ page: 1.5, pageSize: 50 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("שלם");
    }
  });
});

// ============================================================================
// Date Range Schema Tests
// ============================================================================

describe("dateRangeSchema", () => {
  it("accepts valid date range with startDate before endDate", () => {
    const result = dateRangeSchema.safeParse({
      startDate: "2024-01-01",
      endDate: "2024-12-31",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeInstanceOf(Date);
      expect(result.data.endDate).toBeInstanceOf(Date);
    }
  });

  it("accepts same start and end date", () => {
    const result = dateRangeSchema.safeParse({
      startDate: "2024-06-15",
      endDate: "2024-06-15",
    });
    expect(result.success).toBe(true);
  });

  it("accepts only startDate", () => {
    const result = dateRangeSchema.safeParse({
      startDate: "2024-01-01",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeInstanceOf(Date);
      expect(result.data.endDate).toBeUndefined();
    }
  });

  it("accepts only endDate", () => {
    const result = dateRangeSchema.safeParse({
      endDate: "2024-12-31",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeUndefined();
      expect(result.data.endDate).toBeInstanceOf(Date);
    }
  });

  it("accepts empty object (both dates optional)", () => {
    const result = dateRangeSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeUndefined();
      expect(result.data.endDate).toBeUndefined();
    }
  });

  it("rejects startDate after endDate", () => {
    const result = dateRangeSchema.safeParse({
      startDate: "2024-12-31",
      endDate: "2024-01-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("לפני או שווה");
      expect(result.error.issues[0].path).toContain("endDate");
    }
  });

  it("coerces ISO date strings to Date objects", () => {
    const result = dateRangeSchema.safeParse({
      startDate: "2024-06-15T10:30:00Z",
      endDate: "2024-06-15T18:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date strings", () => {
    const result = dateRangeSchema.safeParse({
      startDate: "not-a-date",
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Amount Filter Schema Tests
// ============================================================================

describe("amountFilterSchema", () => {
  it("accepts valid amount range", () => {
    const result = amountFilterSchema.safeParse({
      minAmount: 100,
      maxAmount: 1000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minAmount).toBe(100);
      expect(result.data.maxAmount).toBe(1000);
    }
  });

  it("accepts only minAmount", () => {
    const result = amountFilterSchema.safeParse({
      minAmount: 100,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minAmount).toBe(100);
      expect(result.data.maxAmount).toBeUndefined();
    }
  });

  it("accepts only maxAmount", () => {
    const result = amountFilterSchema.safeParse({
      maxAmount: 1000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts zero amounts", () => {
    const result = amountFilterSchema.safeParse({
      minAmount: 0,
      maxAmount: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = amountFilterSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects negative minAmount", () => {
    const result = amountFilterSchema.safeParse({
      minAmount: -100,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("אפס או גדול יותר");
    }
  });

  it("rejects negative maxAmount", () => {
    const result = amountFilterSchema.safeParse({
      maxAmount: -100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects minAmount greater than maxAmount", () => {
    const result = amountFilterSchema.safeParse({
      minAmount: 1000,
      maxAmount: 100,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("קטן או שווה");
      expect(result.error.issues[0].path).toContain("maxAmount");
    }
  });

  it("accepts same min and max amount", () => {
    const result = amountFilterSchema.safeParse({
      minAmount: 500,
      maxAmount: 500,
    });
    expect(result.success).toBe(true);
  });

  it("coerces string numbers", () => {
    const result = amountFilterSchema.safeParse({
      minAmount: "100",
      maxAmount: "1000",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minAmount).toBe(100);
      expect(result.data.maxAmount).toBe(1000);
    }
  });
});

// ============================================================================
// Commission Filters Schema Tests
// ============================================================================

describe("commissionFiltersSchema", () => {
  it("accepts valid filters with all fields", () => {
    const result = commissionFiltersSchema.safeParse({
      supplierId: "123e4567-e89b-12d3-a456-426614174000",
      franchiseeId: "123e4567-e89b-12d3-a456-426614174001",
      brandId: "123e4567-e89b-12d3-a456-426614174002",
      status: "pending",
      periodKey: "2024-Q1",
      startDate: "2024-01-01",
      endDate: "2024-03-31",
      minAmount: 100,
      maxAmount: 10000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty filters", () => {
    const result = commissionFiltersSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts all valid status values", () => {
    const validStatuses = ["pending", "calculated", "approved", "paid", "cancelled"];

    validStatuses.forEach((status) => {
      const result = commissionFiltersSchema.safeParse({ status });
      expect(result.success).toBe(true);
    });
  });

  it("rejects invalid status value", () => {
    const result = commissionFiltersSchema.safeParse({ status: "invalid-status" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("סטטוס לא תקין");
    }
  });

  it("rejects invalid UUID for supplierId", () => {
    const result = commissionFiltersSchema.safeParse({
      supplierId: "not-a-valid-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid UUID for franchiseeId", () => {
    const result = commissionFiltersSchema.safeParse({
      franchiseeId: "not-a-valid-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid UUID for brandId", () => {
    const result = commissionFiltersSchema.safeParse({
      brandId: "not-a-valid-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("includes date range fields from merged schema", () => {
    // Note: merge() combines shapes but refinements may not carry over
    // Test that the fields are accepted
    const result = commissionFiltersSchema.safeParse({
      startDate: "2024-01-01",
      endDate: "2024-12-31",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeInstanceOf(Date);
      expect(result.data.endDate).toBeInstanceOf(Date);
    }
  });

  it("includes amount filter fields from merged schema", () => {
    // Note: merge() combines shapes but refinements may not carry over
    // Test that the fields are accepted
    const result = commissionFiltersSchema.safeParse({
      minAmount: 100,
      maxAmount: 1000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minAmount).toBe(100);
      expect(result.data.maxAmount).toBe(1000);
    }
  });
});

// ============================================================================
// Deposits Filters Schema Tests
// ============================================================================

describe("depositsFiltersSchema", () => {
  it("accepts valid deposit filters", () => {
    const result = depositsFiltersSchema.safeParse({
      supplierId: "123e4567-e89b-12d3-a456-426614174000",
      franchiseeId: "123e4567-e89b-12d3-a456-426614174001",
      brandId: "123e4567-e89b-12d3-a456-426614174002",
      depositType: "security",
      status: "active",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all valid deposit types", () => {
    const validTypes = ["security", "advance", "credit", "other"];

    validTypes.forEach((depositType) => {
      const result = depositsFiltersSchema.safeParse({ depositType });
      expect(result.success).toBe(true);
    });
  });

  it("accepts all valid deposit statuses", () => {
    const validStatuses = ["active", "used", "returned"];

    validStatuses.forEach((status) => {
      const result = depositsFiltersSchema.safeParse({ status });
      expect(result.success).toBe(true);
    });
  });

  it("rejects invalid deposit type", () => {
    const result = depositsFiltersSchema.safeParse({ depositType: "invalid" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid deposit status", () => {
    const result = depositsFiltersSchema.safeParse({ status: "invalid" });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Unauthorized Suppliers Filters Schema Tests
// ============================================================================

describe("unauthorizedSuppliersFiltersSchema", () => {
  it("accepts valid filters", () => {
    const result = unauthorizedSuppliersFiltersSchema.safeParse({
      franchiseeId: "123e4567-e89b-12d3-a456-426614174000",
      brandId: "123e4567-e89b-12d3-a456-426614174001",
      supplierName: "Test Supplier",
      periodKey: "2024-Q1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty supplierName when provided", () => {
    const result = unauthorizedSuppliersFiltersSchema.safeParse({
      supplierName: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("לפחות תו אחד");
    }
  });

  it("rejects whitespace-only supplierName", () => {
    const result = unauthorizedSuppliersFiltersSchema.safeParse({
      supplierName: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from supplierName", () => {
    const result = unauthorizedSuppliersFiltersSchema.safeParse({
      supplierName: "  Test Supplier  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.supplierName).toBe("Test Supplier");
    }
  });
});

// ============================================================================
// Variance Filters Schema Tests
// ============================================================================

describe("varianceFiltersSchema", () => {
  it("accepts valid variance filters", () => {
    const result = varianceFiltersSchema.safeParse({
      supplierId: "123e4567-e89b-12d3-a456-426614174000",
      franchiseeId: "123e4567-e89b-12d3-a456-426614174001",
      brandId: "123e4567-e89b-12d3-a456-426614174002",
      periodKey: "2024-Q1",
      minVariance: -50,
      maxVariance: 50,
      varianceType: "all",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all valid variance types", () => {
    const validTypes = ["positive", "negative", "all"];

    validTypes.forEach((varianceType) => {
      const result = varianceFiltersSchema.safeParse({ varianceType });
      expect(result.success).toBe(true);
    });
  });

  it("defaults varianceType to 'all'", () => {
    const result = varianceFiltersSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.varianceType).toBe("all");
    }
  });

  it("allows negative variance values", () => {
    const result = varianceFiltersSchema.safeParse({
      minVariance: -100,
      maxVariance: -10,
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Variance Report API Filters Schema Tests
// ============================================================================

describe("varianceReportApiFiltersSchema", () => {
  it("accepts valid API filters with all required dates", () => {
    const result = varianceReportApiFiltersSchema.safeParse({
      currentStartDate: "2024-01-01",
      currentEndDate: "2024-03-31",
      previousStartDate: "2023-01-01",
      previousEndDate: "2023-03-31",
    });
    expect(result.success).toBe(true);
  });

  it("uses default varianceThreshold of 10", () => {
    const result = varianceReportApiFiltersSchema.safeParse({
      currentStartDate: "2024-01-01",
      currentEndDate: "2024-03-31",
      previousStartDate: "2023-01-01",
      previousEndDate: "2023-03-31",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.varianceThreshold).toBe(10);
    }
  });

  it("accepts custom varianceThreshold", () => {
    const result = varianceReportApiFiltersSchema.safeParse({
      currentStartDate: "2024-01-01",
      currentEndDate: "2024-03-31",
      previousStartDate: "2023-01-01",
      previousEndDate: "2023-03-31",
      varianceThreshold: 25,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.varianceThreshold).toBe(25);
    }
  });

  it("rejects varianceThreshold greater than 100", () => {
    const result = varianceReportApiFiltersSchema.safeParse({
      currentStartDate: "2024-01-01",
      currentEndDate: "2024-03-31",
      previousStartDate: "2023-01-01",
      previousEndDate: "2023-03-31",
      varianceThreshold: 101,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative varianceThreshold", () => {
    const result = varianceReportApiFiltersSchema.safeParse({
      currentStartDate: "2024-01-01",
      currentEndDate: "2024-03-31",
      previousStartDate: "2023-01-01",
      previousEndDate: "2023-03-31",
      varianceThreshold: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects currentStartDate after currentEndDate", () => {
    const result = varianceReportApiFiltersSchema.safeParse({
      currentStartDate: "2024-03-31",
      currentEndDate: "2024-01-01",
      previousStartDate: "2023-01-01",
      previousEndDate: "2023-03-31",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("currentEndDate");
    }
  });

  it("rejects previousStartDate after previousEndDate", () => {
    const result = varianceReportApiFiltersSchema.safeParse({
      currentStartDate: "2024-01-01",
      currentEndDate: "2024-03-31",
      previousStartDate: "2023-03-31",
      previousEndDate: "2023-01-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("previousEndDate");
    }
  });

  it("requires all date fields", () => {
    const result = varianceReportApiFiltersSchema.safeParse({
      currentStartDate: "2024-01-01",
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Invoice Filters Schema Tests
// ============================================================================

describe("invoiceFiltersSchema", () => {
  it("accepts valid invoice filters", () => {
    const result = invoiceFiltersSchema.safeParse({
      managementCompanyId: "123e4567-e89b-12d3-a456-426614174000",
      brandId: "123e4567-e89b-12d3-a456-426614174001",
      periodKey: "2024-Q1",
      invoiceStatus: "draft",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all valid invoice statuses", () => {
    const validStatuses = ["draft", "issued", "sent", "paid"];

    validStatuses.forEach((invoiceStatus) => {
      const result = invoiceFiltersSchema.safeParse({ invoiceStatus });
      expect(result.success).toBe(true);
    });
  });

  it("rejects invalid invoice status", () => {
    const result = invoiceFiltersSchema.safeParse({ invoiceStatus: "invalid" });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Batch Create Schema Tests
// ============================================================================

describe("batchCreateSchema", () => {
  const itemSchema = z.object({
    name: z.string(),
    value: z.number(),
  });

  const batchSchema = batchCreateSchema(itemSchema);

  it("accepts valid batch with items within limit", () => {
    const result = batchSchema.safeParse({
      items: [
        { name: "Item 1", value: 100 },
        { name: "Item 2", value: 200 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts exactly 100 items", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      name: `Item ${i}`,
      value: i,
    }));
    const result = batchSchema.safeParse({ items });
    expect(result.success).toBe(true);
  });

  it("rejects more than 100 items", () => {
    const items = Array.from({ length: 101 }, (_, i) => ({
      name: `Item ${i}`,
      value: i,
    }));
    const result = batchSchema.safeParse({ items });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("100 פריטים");
    }
  });

  it("rejects empty items array", () => {
    const result = batchSchema.safeParse({ items: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("לפחות פריט אחד");
    }
  });

  it("validates individual items", () => {
    const result = batchSchema.safeParse({
      items: [{ name: "Item 1", value: "not-a-number" }],
    });
    expect(result.success).toBe(false);
  });

  it("is strict and rejects extra fields", () => {
    const result = batchSchema.safeParse({
      items: [{ name: "Item 1", value: 100 }],
      extraField: "should fail",
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Batch Delete Schema Tests
// ============================================================================

describe("batchDeleteSchema", () => {
  it("accepts valid UUIDs", () => {
    const result = batchDeleteSchema.safeParse({
      ids: [
        "123e4567-e89b-12d3-a456-426614174000",
        "123e4567-e89b-12d3-a456-426614174001",
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts exactly 100 IDs", () => {
    const ids = Array.from(
      { length: 100 },
      (_, i) => `123e4567-e89b-12d3-a456-42661417400${i.toString().padStart(1, "0")}`
    ).map(() => "123e4567-e89b-12d3-a456-426614174000");
    const result = batchDeleteSchema.safeParse({ ids });
    expect(result.success).toBe(true);
  });

  it("rejects more than 100 IDs", () => {
    const ids = Array.from({ length: 101 }, () => "123e4567-e89b-12d3-a456-426614174000");
    const result = batchDeleteSchema.safeParse({ ids });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("100 פריטים");
    }
  });

  it("rejects empty IDs array", () => {
    const result = batchDeleteSchema.safeParse({ ids: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("לפחות מזהה אחד");
    }
  });

  it("rejects invalid UUIDs", () => {
    const result = batchDeleteSchema.safeParse({
      ids: ["not-a-valid-uuid"],
    });
    expect(result.success).toBe(false);
  });

  it("is strict and rejects extra fields", () => {
    const result = batchDeleteSchema.safeParse({
      ids: ["123e4567-e89b-12d3-a456-426614174000"],
      extraField: "should fail",
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Export Request Schema Tests
// ============================================================================

describe("exportRequestSchema", () => {
  it("accepts valid export request", () => {
    const result = exportRequestSchema.safeParse({
      format: "xlsx",
      includeMetadata: true,
      filename: "commission-report",
    });
    expect(result.success).toBe(true);
  });

  it("uses default format of xlsx", () => {
    const result = exportRequestSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.format).toBe("xlsx");
    }
  });

  it("uses default includeMetadata of true", () => {
    const result = exportRequestSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeMetadata).toBe(true);
    }
  });

  it("accepts all valid formats", () => {
    const validFormats = ["csv", "xlsx", "pdf"];

    validFormats.forEach((format) => {
      const result = exportRequestSchema.safeParse({ format });
      expect(result.success).toBe(true);
    });
  });

  it("rejects invalid format", () => {
    const result = exportRequestSchema.safeParse({ format: "json" });
    expect(result.success).toBe(false);
  });

  it("accepts Hebrew filename", () => {
    const result = exportRequestSchema.safeParse({
      filename: "דוח עמלות",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filename).toBe("דוח עמלות");
    }
  });

  it("accepts filename with allowed special characters", () => {
    const result = exportRequestSchema.safeParse({
      filename: "report_2024-Q1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects filename with invalid characters", () => {
    const result = exportRequestSchema.safeParse({
      filename: "report/2024",
    });
    expect(result.success).toBe(false);
  });

  it("rejects filename longer than 255 characters", () => {
    const result = exportRequestSchema.safeParse({
      filename: "a".repeat(256),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("255");
    }
  });

  it("trims whitespace from filename", () => {
    const result = exportRequestSchema.safeParse({
      filename: "  report  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filename).toBe("report");
    }
  });
});

// ============================================================================
// Sort Direction Schema Tests
// ============================================================================

describe("sortDirectionSchema", () => {
  it("accepts 'asc'", () => {
    const result = sortDirectionSchema.safeParse("asc");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("asc");
    }
  });

  it("accepts 'desc'", () => {
    const result = sortDirectionSchema.safeParse("desc");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("desc");
    }
  });

  it("defaults to 'asc'", () => {
    const result = sortDirectionSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("asc");
    }
  });

  it("rejects invalid direction", () => {
    const result = sortDirectionSchema.safeParse("ascending");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("asc או desc");
    }
  });
});

// ============================================================================
// Create Sort Schema Tests
// ============================================================================

describe("createSortSchema", () => {
  const sortableFields = ["name", "date", "amount"] as const;
  const sortSchema = createSortSchema(sortableFields);

  it("accepts valid sortBy field", () => {
    const result = sortSchema.safeParse({ sortBy: "name" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sortBy).toBe("name");
    }
  });

  it("accepts all valid sortable fields", () => {
    sortableFields.forEach((field) => {
      const result = sortSchema.safeParse({ sortBy: field });
      expect(result.success).toBe(true);
    });
  });

  it("rejects invalid sortBy field", () => {
    const result = sortSchema.safeParse({ sortBy: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts sortDirection with sortBy", () => {
    const result = sortSchema.safeParse({
      sortBy: "amount",
      sortDirection: "desc",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sortBy).toBe("amount");
      expect(result.data.sortDirection).toBe("desc");
    }
  });

  it("accepts empty object (all optional)", () => {
    const result = sortSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sortBy).toBeUndefined();
      // sortDirection has a default value of "asc" from sortDirectionSchema
      expect(result.data.sortDirection).toBe("asc");
    }
  });
});
