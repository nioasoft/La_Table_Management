import { describe, it, expect } from "vitest";
import {
  normalizePaginationParams,
  createPaginatedResult,
  parsePaginationFromSearchParams,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type PaginationParams,
} from "@/lib/pagination";

// ============================================================================
// Normalize Pagination Params Tests
// ============================================================================

describe("normalizePaginationParams", () => {
  describe("default values", () => {
    it("uses default page of 1 when not provided", () => {
      const result = normalizePaginationParams({});
      expect(result.page).toBe(1);
    });

    it("uses default page size when not provided", () => {
      const result = normalizePaginationParams({});
      expect(result.limit).toBe(DEFAULT_PAGE_SIZE);
    });

    it("calculates offset as 0 for first page", () => {
      const result = normalizePaginationParams({});
      expect(result.offset).toBe(0);
    });
  });

  describe("page parameter", () => {
    it("accepts valid page numbers", () => {
      expect(normalizePaginationParams({ page: 1 }).page).toBe(1);
      expect(normalizePaginationParams({ page: 5 }).page).toBe(5);
      expect(normalizePaginationParams({ page: 100 }).page).toBe(100);
    });

    it("enforces minimum page of 1 for zero", () => {
      const result = normalizePaginationParams({ page: 0 });
      expect(result.page).toBe(1);
    });

    it("enforces minimum page of 1 for negative values", () => {
      expect(normalizePaginationParams({ page: -1 }).page).toBe(1);
      expect(normalizePaginationParams({ page: -100 }).page).toBe(1);
    });
  });

  describe("limit parameter", () => {
    it("accepts valid limit values", () => {
      expect(normalizePaginationParams({ limit: 10 }).limit).toBe(10);
      expect(normalizePaginationParams({ limit: 50 }).limit).toBe(50);
      expect(normalizePaginationParams({ limit: MAX_PAGE_SIZE }).limit).toBe(MAX_PAGE_SIZE);
    });

    it("enforces minimum limit of 1", () => {
      expect(normalizePaginationParams({ limit: 0 }).limit).toBe(1);
      expect(normalizePaginationParams({ limit: -1 }).limit).toBe(1);
    });

    it("enforces maximum limit of MAX_PAGE_SIZE", () => {
      expect(normalizePaginationParams({ limit: MAX_PAGE_SIZE + 1 }).limit).toBe(MAX_PAGE_SIZE);
      expect(normalizePaginationParams({ limit: 1000 }).limit).toBe(MAX_PAGE_SIZE);
    });
  });

  describe("offset calculation", () => {
    it("calculates correct offset for page 1", () => {
      const result = normalizePaginationParams({ page: 1, limit: 50 });
      expect(result.offset).toBe(0);
    });

    it("calculates correct offset for page 2", () => {
      const result = normalizePaginationParams({ page: 2, limit: 50 });
      expect(result.offset).toBe(50);
    });

    it("calculates correct offset for page 3 with custom limit", () => {
      const result = normalizePaginationParams({ page: 3, limit: 25 });
      expect(result.offset).toBe(50);
    });

    it("calculates correct offset for large page numbers", () => {
      const result = normalizePaginationParams({ page: 100, limit: 10 });
      expect(result.offset).toBe(990);
    });
  });

  describe("combined parameters", () => {
    it("handles all parameters together", () => {
      const result = normalizePaginationParams({ page: 5, limit: 20 });
      expect(result.page).toBe(5);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(80);
    });

    it("normalizes invalid values in combination", () => {
      const result = normalizePaginationParams({ page: -5, limit: 500 });
      expect(result.page).toBe(1);
      expect(result.limit).toBe(MAX_PAGE_SIZE);
      expect(result.offset).toBe(0);
    });
  });
});

// ============================================================================
// Create Paginated Result Tests
// ============================================================================

describe("createPaginatedResult", () => {
  describe("basic functionality", () => {
    it("creates result with data and pagination metadata", () => {
      const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const result = createPaginatedResult(data, 100, { page: 1, limit: 10 });

      expect(result.data).toEqual(data);
      expect(result.pagination).toBeDefined();
    });

    it("includes all pagination fields", () => {
      const result = createPaginatedResult([], 50, { page: 1, limit: 10 });

      expect(result.pagination).toHaveProperty("page");
      expect(result.pagination).toHaveProperty("pageSize");
      expect(result.pagination).toHaveProperty("totalCount");
      expect(result.pagination).toHaveProperty("totalPages");
      expect(result.pagination).toHaveProperty("hasMore");
      expect(result.pagination).toHaveProperty("hasPrevious");
    });
  });

  describe("pagination calculations", () => {
    it("calculates correct totalPages", () => {
      expect(
        createPaginatedResult([], 100, { page: 1, limit: 10 }).pagination.totalPages
      ).toBe(10);
      expect(
        createPaginatedResult([], 95, { page: 1, limit: 10 }).pagination.totalPages
      ).toBe(10);
      expect(
        createPaginatedResult([], 91, { page: 1, limit: 10 }).pagination.totalPages
      ).toBe(10);
      expect(
        createPaginatedResult([], 90, { page: 1, limit: 10 }).pagination.totalPages
      ).toBe(9);
    });

    it("handles zero totalCount", () => {
      const result = createPaginatedResult([], 0, { page: 1, limit: 10 });
      expect(result.pagination.totalPages).toBe(0);
      expect(result.pagination.hasMore).toBe(false);
    });

    it("handles single page", () => {
      const result = createPaginatedResult([], 5, { page: 1, limit: 10 });
      expect(result.pagination.totalPages).toBe(1);
      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.hasPrevious).toBe(false);
    });
  });

  describe("hasMore calculation", () => {
    it("returns true when more pages exist", () => {
      const result = createPaginatedResult([], 100, { page: 1, limit: 10 });
      expect(result.pagination.hasMore).toBe(true);
    });

    it("returns false on last page", () => {
      const result = createPaginatedResult([], 100, { page: 10, limit: 10 });
      expect(result.pagination.hasMore).toBe(false);
    });

    it("returns false when beyond last page", () => {
      const result = createPaginatedResult([], 100, { page: 15, limit: 10 });
      expect(result.pagination.hasMore).toBe(false);
    });
  });

  describe("hasPrevious calculation", () => {
    it("returns false on first page", () => {
      const result = createPaginatedResult([], 100, { page: 1, limit: 10 });
      expect(result.pagination.hasPrevious).toBe(false);
    });

    it("returns true on subsequent pages", () => {
      expect(
        createPaginatedResult([], 100, { page: 2, limit: 10 }).pagination.hasPrevious
      ).toBe(true);
      expect(
        createPaginatedResult([], 100, { page: 10, limit: 10 }).pagination.hasPrevious
      ).toBe(true);
    });
  });

  describe("preserves input data", () => {
    it("preserves the data array exactly", () => {
      const originalData = [
        { id: 1, name: "Item 1" },
        { id: 2, name: "Item 2" },
      ];
      const result = createPaginatedResult(originalData, 50, { page: 1, limit: 10 });
      expect(result.data).toBe(originalData);
      expect(result.data).toEqual(originalData);
    });

    it("handles empty array", () => {
      const result = createPaginatedResult([], 0, { page: 1, limit: 10 });
      expect(result.data).toEqual([]);
    });
  });
});

// ============================================================================
// Parse Pagination From Search Params Tests
// ============================================================================

describe("parsePaginationFromSearchParams", () => {
  it("parses page parameter", () => {
    const params = new URLSearchParams("page=5");
    const result = parsePaginationFromSearchParams(params);
    expect(result.page).toBe(5);
  });

  it("parses limit parameter", () => {
    const params = new URLSearchParams("limit=25");
    const result = parsePaginationFromSearchParams(params);
    expect(result.limit).toBe(25);
  });

  it("parses pageSize as alias for limit", () => {
    const params = new URLSearchParams("pageSize=30");
    const result = parsePaginationFromSearchParams(params);
    expect(result.limit).toBe(30);
  });

  it("prefers limit over pageSize", () => {
    const params = new URLSearchParams("limit=20&pageSize=30");
    const result = parsePaginationFromSearchParams(params);
    expect(result.limit).toBe(20);
  });

  it("parses both parameters together", () => {
    const params = new URLSearchParams("page=3&limit=25");
    const result = parsePaginationFromSearchParams(params);
    expect(result.page).toBe(3);
    expect(result.limit).toBe(25);
  });

  it("returns undefined for missing page", () => {
    const params = new URLSearchParams("limit=25");
    const result = parsePaginationFromSearchParams(params);
    expect(result.page).toBeUndefined();
  });

  it("returns undefined for missing limit", () => {
    const params = new URLSearchParams("page=1");
    const result = parsePaginationFromSearchParams(params);
    expect(result.limit).toBeUndefined();
  });

  it("returns empty object for no pagination params", () => {
    const params = new URLSearchParams("");
    const result = parsePaginationFromSearchParams(params);
    expect(result.page).toBeUndefined();
    expect(result.limit).toBeUndefined();
  });

  it("handles non-numeric strings", () => {
    const params = new URLSearchParams("page=abc&limit=xyz");
    const result = parsePaginationFromSearchParams(params);
    expect(result.page).toBeNaN();
    expect(result.limit).toBeNaN();
  });

  it("handles decimal strings (truncates)", () => {
    const params = new URLSearchParams("page=2.5");
    const result = parsePaginationFromSearchParams(params);
    expect(result.page).toBe(2);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("pagination integration", () => {
  it("workflow: parse -> normalize -> create result", () => {
    // Step 1: Parse from URL
    const params = new URLSearchParams("page=3&limit=25");
    const parsed = parsePaginationFromSearchParams(params);

    // Step 2: Normalize
    const normalized = normalizePaginationParams(parsed);

    // Step 3: Create result
    const data = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const result = createPaginatedResult(data, 100, normalized);

    expect(result.data).toHaveLength(25);
    expect(result.pagination.page).toBe(3);
    expect(result.pagination.pageSize).toBe(25);
    expect(result.pagination.totalCount).toBe(100);
    expect(result.pagination.totalPages).toBe(4);
    expect(result.pagination.hasMore).toBe(true);
    expect(result.pagination.hasPrevious).toBe(true);
  });

  it("handles edge case of last page", () => {
    const params = new URLSearchParams("page=4&limit=25");
    const parsed = parsePaginationFromSearchParams(params);
    const normalized = normalizePaginationParams(parsed);
    const data = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const result = createPaginatedResult(data, 100, normalized);

    expect(result.pagination.page).toBe(4);
    expect(result.pagination.hasMore).toBe(false);
    expect(result.pagination.hasPrevious).toBe(true);
  });

  it("handles invalid params gracefully", () => {
    const params = new URLSearchParams("page=-5&limit=9999");
    const parsed = parsePaginationFromSearchParams(params);
    const normalized = normalizePaginationParams(parsed);

    expect(normalized.page).toBe(1);
    expect(normalized.limit).toBe(MAX_PAGE_SIZE);
  });
});
