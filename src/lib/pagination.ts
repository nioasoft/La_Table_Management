/**
 * Pagination utilities for data access layer
 * Provides consistent pagination across all list endpoints
 */

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
    hasMore: boolean;
    hasPrevious: boolean;
  };
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/**
 * Normalize pagination parameters with defaults and bounds
 */
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

/**
 * Create a paginated result from data and total count
 */
export function createPaginatedResult<T>(
  data: T[],
  totalCount: number,
  params: { page: number; limit: number }
): PaginatedResult<T> {
  const totalPages = Math.ceil(totalCount / params.limit);

  return {
    data,
    pagination: {
      page: params.page,
      pageSize: params.limit,
      totalCount,
      totalPages,
      hasMore: params.page < totalPages,
      hasPrevious: params.page > 1,
    },
  };
}

/**
 * Parse pagination params from URL search params
 */
export function parsePaginationFromSearchParams(
  searchParams: URLSearchParams
): PaginationParams {
  const page = searchParams.get("page");
  const limit = searchParams.get("limit") || searchParams.get("pageSize");

  return {
    page: page ? parseInt(page, 10) : undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
  };
}
