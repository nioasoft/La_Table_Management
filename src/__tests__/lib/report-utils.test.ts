import { describe, it, expect } from "vitest";
import {
  formatPercent,
  formatDateHe,
  formatDateRange,
  formatNumber,
  getStatusConfig,
  commissionStatusConfig,
  settlementStatusConfig,
  franchiseeStatusConfig,
  activeStatusConfig,
  sortCompare,
  sortData,
  calculatePagination,
  paginateData,
  filterBySearch,
  generateReportFilename,
  type SortConfig,
  type SortDirection,
} from "@/lib/report-utils";

// ============================================================================
// Formatter Tests
// ============================================================================

describe("formatPercent", () => {
  it("formats positive numbers as percentages", () => {
    expect(formatPercent(10)).toBe("10.00%");
    expect(formatPercent(5.5)).toBe("5.50%");
    expect(formatPercent(0.25)).toBe("0.25%");
  });

  it("formats zero as percentage", () => {
    expect(formatPercent(0)).toBe("0.00%");
  });

  it("formats negative numbers as percentages", () => {
    expect(formatPercent(-5)).toBe("-5.00%");
  });

  it("handles null value", () => {
    expect(formatPercent(null)).toBe("0.00%");
  });

  it("handles undefined value", () => {
    expect(formatPercent(undefined)).toBe("0.00%");
  });

  it("maintains precision to 2 decimal places", () => {
    expect(formatPercent(3.14159)).toBe("3.14%");
    expect(formatPercent(3.145)).toBe("3.15%"); // Rounding
    expect(formatPercent(3.144)).toBe("3.14%");
  });
});

describe("formatDateHe", () => {
  it("formats valid date string", () => {
    const result = formatDateHe("2024-01-15");
    // Should be formatted in Hebrew locale (DD.MM.YYYY or similar)
    expect(result).not.toBe("-");
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles null date", () => {
    expect(formatDateHe(null)).toBe("-");
  });

  it("handles undefined date", () => {
    expect(formatDateHe(undefined)).toBe("-");
  });

  it("handles empty string", () => {
    // Empty string creates invalid date
    expect(formatDateHe("")).toBe("-");
  });

  it("formats ISO date string correctly", () => {
    const result = formatDateHe("2024-12-31T10:30:00Z");
    expect(result).not.toBe("-");
  });
});

describe("formatDateRange", () => {
  it("formats date range correctly", () => {
    const result = formatDateRange("2024-01-01", "2024-03-31");
    expect(result).toContain(" - ");
  });
});

describe("formatNumber", () => {
  it("formats positive numbers with thousands separator", () => {
    const result = formatNumber(1234567);
    expect(result).toBe("1,234,567");
  });

  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  it("formats negative numbers", () => {
    const result = formatNumber(-1234);
    // Expect thousands separator
    expect(result.replace(/[^0-9-]/g, "")).toBe("-1234");
  });

  it("handles null value", () => {
    expect(formatNumber(null)).toBe("0");
  });

  it("handles undefined value", () => {
    expect(formatNumber(undefined)).toBe("0");
  });

  it("handles string numbers", () => {
    const result = formatNumber("1234567");
    expect(result).toBe("1,234,567");
  });

  it("formats decimal numbers", () => {
    const result = formatNumber(1234.56);
    expect(result).toContain("1,234");
  });
});

// ============================================================================
// Status Configuration Tests
// ============================================================================

describe("commissionStatusConfig", () => {
  it("has all required status types", () => {
    const expectedStatuses = ["pending", "calculated", "approved", "paid", "cancelled"];
    expectedStatuses.forEach((status) => {
      expect(commissionStatusConfig[status]).toBeDefined();
      expect(commissionStatusConfig[status].label).toBeTruthy();
      expect(commissionStatusConfig[status].variant).toBeTruthy();
    });
  });
});

describe("settlementStatusConfig", () => {
  it("has all required status types", () => {
    const expectedStatuses = [
      "draft",
      "open",
      "processing",
      "pending_approval",
      "approved",
      "completed",
      "invoiced",
    ];
    expectedStatuses.forEach((status) => {
      expect(settlementStatusConfig[status]).toBeDefined();
      expect(settlementStatusConfig[status].label).toBeTruthy();
    });
  });
});

describe("franchiseeStatusConfig", () => {
  it("has all required status types", () => {
    const expectedStatuses = ["active", "inactive", "pending", "suspended", "terminated"];
    expectedStatuses.forEach((status) => {
      expect(franchiseeStatusConfig[status]).toBeDefined();
      expect(franchiseeStatusConfig[status].label).toBeTruthy();
    });
  });
});

describe("activeStatusConfig", () => {
  it("has active and inactive statuses", () => {
    expect(activeStatusConfig.active).toBeDefined();
    expect(activeStatusConfig.inactive).toBeDefined();
    expect(activeStatusConfig.active.variant).toBe("success");
    expect(activeStatusConfig.inactive.variant).toBe("secondary");
  });
});

describe("getStatusConfig", () => {
  it("returns correct config for commission status", () => {
    const config = getStatusConfig("pending", "commission");
    expect(config.label).toBe("ממתין");
    expect(config.variant).toBe("secondary");
  });

  it("returns correct config for settlement status", () => {
    const config = getStatusConfig("approved", "settlement");
    expect(config.label).toBe("מאושר");
    expect(config.variant).toBe("success");
  });

  it("returns correct config for franchisee status", () => {
    const config = getStatusConfig("active", "franchisee");
    expect(config.label).toBe("פעיל");
    expect(config.variant).toBe("success");
  });

  it("returns correct config for active status", () => {
    const config = getStatusConfig("active", "active");
    expect(config.label).toBe("פעיל");
    expect(config.variant).toBe("success");
  });

  it("returns fallback for unknown status", () => {
    const config = getStatusConfig("unknown-status", "commission");
    expect(config.label).toBe("unknown-status");
    expect(config.variant).toBe("outline");
  });
});

// ============================================================================
// Sorting Tests
// ============================================================================

describe("sortCompare", () => {
  interface TestItem {
    name: string;
    amount: number;
    date: string | null;
  }

  it("sorts numbers ascending", () => {
    const a: TestItem = { name: "A", amount: 100, date: null };
    const b: TestItem = { name: "B", amount: 200, date: null };

    expect(sortCompare(a, b, "amount", "asc")).toBeLessThan(0);
    expect(sortCompare(b, a, "amount", "asc")).toBeGreaterThan(0);
  });

  it("sorts numbers descending", () => {
    const a: TestItem = { name: "A", amount: 100, date: null };
    const b: TestItem = { name: "B", amount: 200, date: null };

    expect(sortCompare(a, b, "amount", "desc")).toBeGreaterThan(0);
    expect(sortCompare(b, a, "amount", "desc")).toBeLessThan(0);
  });

  it("sorts strings ascending", () => {
    const a: TestItem = { name: "Apple", amount: 0, date: null };
    const b: TestItem = { name: "Banana", amount: 0, date: null };

    expect(sortCompare(a, b, "name", "asc")).toBeLessThan(0);
    expect(sortCompare(b, a, "name", "asc")).toBeGreaterThan(0);
  });

  it("sorts strings descending", () => {
    const a: TestItem = { name: "Apple", amount: 0, date: null };
    const b: TestItem = { name: "Banana", amount: 0, date: null };

    expect(sortCompare(a, b, "name", "desc")).toBeGreaterThan(0);
  });

  it("returns 0 for null direction", () => {
    const a: TestItem = { name: "A", amount: 100, date: null };
    const b: TestItem = { name: "B", amount: 200, date: null };

    expect(sortCompare(a, b, "amount", null)).toBe(0);
  });

  it("handles null values in ascending order", () => {
    const a: TestItem = { name: "A", amount: 100, date: null };
    const b: TestItem = { name: "B", amount: 200, date: "2024-01-01" };

    expect(sortCompare(a, b, "date", "asc")).toBeGreaterThan(0);
    expect(sortCompare(b, a, "date", "asc")).toBeLessThan(0);
  });

  it("handles null values in descending order", () => {
    const a: TestItem = { name: "A", amount: 100, date: null };
    const b: TestItem = { name: "B", amount: 200, date: "2024-01-01" };

    expect(sortCompare(a, b, "date", "desc")).toBeLessThan(0);
    expect(sortCompare(b, a, "date", "desc")).toBeGreaterThan(0);
  });

  it("handles equal values", () => {
    const a: TestItem = { name: "A", amount: 100, date: null };
    const b: TestItem = { name: "B", amount: 100, date: null };

    expect(sortCompare(a, b, "amount", "asc")).toBe(0);
    expect(sortCompare(a, b, "amount", "desc")).toBe(0);
  });

  it("handles both null values", () => {
    const a: TestItem = { name: "A", amount: 100, date: null };
    const b: TestItem = { name: "B", amount: 200, date: null };

    expect(sortCompare(a, b, "date", "asc")).toBe(0);
  });
});

describe("sortData", () => {
  interface TestItem {
    name: string;
    amount: number;
  }

  const testData: TestItem[] = [
    { name: "Charlie", amount: 300 },
    { name: "Alice", amount: 100 },
    { name: "Bob", amount: 200 },
  ];

  it("sorts by name ascending", () => {
    const sortConfig: SortConfig = { column: "name", direction: "asc" };
    const result = sortData(testData, sortConfig);

    expect(result[0].name).toBe("Alice");
    expect(result[1].name).toBe("Bob");
    expect(result[2].name).toBe("Charlie");
  });

  it("sorts by amount descending", () => {
    const sortConfig: SortConfig = { column: "amount", direction: "desc" };
    const result = sortData(testData, sortConfig);

    expect(result[0].amount).toBe(300);
    expect(result[1].amount).toBe(200);
    expect(result[2].amount).toBe(100);
  });

  it("returns original data for null sortConfig", () => {
    const result = sortData(testData, null);
    expect(result).toEqual(testData);
  });

  it("returns original data for null direction", () => {
    const sortConfig: SortConfig = { column: "name", direction: null };
    const result = sortData(testData, sortConfig);
    expect(result).toEqual(testData);
  });

  it("does not mutate original array", () => {
    const original = [...testData];
    const sortConfig: SortConfig = { column: "amount", direction: "asc" };
    sortData(testData, sortConfig);

    expect(testData).toEqual(original);
  });
});

// ============================================================================
// Pagination Tests
// ============================================================================

describe("calculatePagination", () => {
  it("calculates correct values for first page", () => {
    const result = calculatePagination({ page: 1, pageSize: 10, total: 95 });

    expect(result.totalPages).toBe(10);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(10);
    expect(result.hasNextPage).toBe(true);
    expect(result.hasPrevPage).toBe(false);
    expect(result.showingFrom).toBe(1);
    expect(result.showingTo).toBe(10);
  });

  it("calculates correct values for middle page", () => {
    const result = calculatePagination({ page: 5, pageSize: 10, total: 95 });

    expect(result.startIndex).toBe(40);
    expect(result.endIndex).toBe(50);
    expect(result.hasNextPage).toBe(true);
    expect(result.hasPrevPage).toBe(true);
    expect(result.showingFrom).toBe(41);
    expect(result.showingTo).toBe(50);
  });

  it("calculates correct values for last page", () => {
    const result = calculatePagination({ page: 10, pageSize: 10, total: 95 });

    expect(result.startIndex).toBe(90);
    expect(result.endIndex).toBe(95);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPrevPage).toBe(true);
    expect(result.showingFrom).toBe(91);
    expect(result.showingTo).toBe(95);
  });

  it("handles empty data", () => {
    const result = calculatePagination({ page: 1, pageSize: 10, total: 0 });

    expect(result.totalPages).toBe(0);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPrevPage).toBe(false);
    expect(result.showingFrom).toBe(0);
    expect(result.showingTo).toBe(0);
  });

  it("handles single page", () => {
    const result = calculatePagination({ page: 1, pageSize: 10, total: 5 });

    expect(result.totalPages).toBe(1);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPrevPage).toBe(false);
    expect(result.showingFrom).toBe(1);
    expect(result.showingTo).toBe(5);
  });
});

describe("paginateData", () => {
  const testData = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }));

  it("returns first page of data", () => {
    const result = paginateData(testData, 1, 10);

    expect(result).toHaveLength(10);
    expect(result[0].id).toBe(1);
    expect(result[9].id).toBe(10);
  });

  it("returns middle page of data", () => {
    const result = paginateData(testData, 2, 10);

    expect(result).toHaveLength(10);
    expect(result[0].id).toBe(11);
    expect(result[9].id).toBe(20);
  });

  it("returns partial last page", () => {
    const result = paginateData(testData, 3, 10);

    expect(result).toHaveLength(5);
    expect(result[0].id).toBe(21);
    expect(result[4].id).toBe(25);
  });

  it("returns empty array for page beyond data", () => {
    const result = paginateData(testData, 10, 10);
    expect(result).toHaveLength(0);
  });

  it("does not mutate original array", () => {
    const original = [...testData];
    paginateData(testData, 1, 10);
    expect(testData).toEqual(original);
  });
});

// ============================================================================
// Search/Filter Tests
// ============================================================================

describe("filterBySearch", () => {
  interface TestItem {
    name: string;
    code: string;
    amount: number;
  }

  const testData: TestItem[] = [
    { name: "Alice Smith", code: "ABC123", amount: 100 },
    { name: "Bob Jones", code: "XYZ789", amount: 200 },
    { name: "Charlie Brown", code: "ABC456", amount: 300 },
  ];

  it("filters by partial name match", () => {
    const result = filterBySearch(testData, "alice", ["name"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alice Smith");
  });

  it("filters case-insensitively", () => {
    const result = filterBySearch(testData, "ALICE", ["name"]);
    expect(result).toHaveLength(1);
  });

  it("filters across multiple columns", () => {
    const result = filterBySearch(testData, "ABC", ["name", "code"]);
    expect(result).toHaveLength(2);
  });

  it("returns all data for empty search term", () => {
    const result = filterBySearch(testData, "", ["name"]);
    expect(result).toEqual(testData);
  });

  it("returns all data for whitespace-only search term", () => {
    const result = filterBySearch(testData, "   ", ["name"]);
    expect(result).toEqual(testData);
  });

  it("returns empty array when no matches", () => {
    const result = filterBySearch(testData, "nonexistent", ["name", "code"]);
    expect(result).toHaveLength(0);
  });

  it("handles numeric columns", () => {
    const result = filterBySearch(testData, "100", ["amount" as keyof TestItem]);
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(100);
  });

  it("trims search term", () => {
    const result = filterBySearch(testData, "  alice  ", ["name"]);
    expect(result).toHaveLength(1);
  });
});

// ============================================================================
// Export Utilities Tests
// ============================================================================

describe("generateReportFilename", () => {
  it("generates filename with xlsx extension by default", () => {
    const result = generateReportFilename("commissions");
    expect(result).toMatch(/^commissions_report_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("generates filename with pdf extension", () => {
    const result = generateReportFilename("invoice", "pdf");
    expect(result).toMatch(/^invoice_report_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("includes current date in ISO format", () => {
    const today = new Date().toISOString().split("T")[0];
    const result = generateReportFilename("test");
    expect(result).toContain(today);
  });

  it("handles report type with special characters", () => {
    const result = generateReportFilename("commission-variance");
    expect(result).toContain("commission-variance");
  });
});
