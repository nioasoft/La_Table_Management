"use client";

import { useState, useCallback, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

// ============================================================================
// TYPES
// ============================================================================

export interface UsePaginationOptions {
  /** Initial page number (1-indexed) */
  initialPage?: number;
  /** Initial page size */
  initialPageSize?: number;
  /** Total number of items */
  totalItems?: number;
  /** Available page size options */
  pageSizeOptions?: number[];
  /** Sync pagination to URL search params */
  syncToUrl?: boolean;
}

export interface PaginationState {
  page: number;
  pageSize: number;
  totalItems: number;
}

export interface PaginationInfo {
  /** Current page (1-indexed) */
  page: number;
  /** Items per page */
  pageSize: number;
  /** Total number of items */
  totalItems: number;
  /** Total number of pages */
  totalPages: number;
  /** Index of first item on current page (0-indexed) */
  startIndex: number;
  /** Index of last item on current page (0-indexed, exclusive) */
  endIndex: number;
  /** Display string for "Showing X of Y" */
  showingFrom: number;
  /** Display string for "Showing X of Y" */
  showingTo: number;
  /** Whether there is a next page */
  hasNextPage: boolean;
  /** Whether there is a previous page */
  hasPrevPage: boolean;
  /** Whether currently on first page */
  isFirstPage: boolean;
  /** Whether currently on last page */
  isLastPage: boolean;
}

// ============================================================================
// HOOK
// ============================================================================

const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function useReportPagination(options: UsePaginationOptions = {}) {
  const {
    initialPage = 1,
    initialPageSize = DEFAULT_PAGE_SIZE,
    totalItems: initialTotalItems = 0,
    pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
    syncToUrl = false,
  } = options;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initialize from URL if syncing
  const getInitialState = useCallback((): PaginationState => {
    if (syncToUrl) {
      const pageParam = searchParams.get("page");
      const pageSizeParam = searchParams.get("pageSize");
      return {
        page: pageParam ? Math.max(1, parseInt(pageParam, 10)) : initialPage,
        pageSize: pageSizeParam ? parseInt(pageSizeParam, 10) : initialPageSize,
        totalItems: initialTotalItems,
      };
    }
    return { page: initialPage, pageSize: initialPageSize, totalItems: initialTotalItems };
  }, [syncToUrl, searchParams, initialPage, initialPageSize, initialTotalItems]);

  const [state, setState] = useState<PaginationState>(getInitialState);

  // Calculate pagination info
  const paginationInfo = useMemo((): PaginationInfo => {
    const { page, pageSize, totalItems } = state;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const clampedPage = Math.min(Math.max(1, page), totalPages);
    const startIndex = (clampedPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalItems);

    return {
      page: clampedPage,
      pageSize,
      totalItems,
      totalPages,
      startIndex,
      endIndex,
      showingFrom: totalItems > 0 ? startIndex + 1 : 0,
      showingTo: endIndex,
      hasNextPage: clampedPage < totalPages,
      hasPrevPage: clampedPage > 1,
      isFirstPage: clampedPage === 1,
      isLastPage: clampedPage >= totalPages,
    };
  }, [state]);

  // Update URL params if syncing
  const updateUrl = useCallback(
    (page: number, pageSize: number) => {
      if (!syncToUrl) return;

      const params = new URLSearchParams(searchParams.toString());
      if (page !== 1) {
        params.set("page", String(page));
      } else {
        params.delete("page");
      }
      if (pageSize !== DEFAULT_PAGE_SIZE) {
        params.set("pageSize", String(pageSize));
      } else {
        params.delete("pageSize");
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [syncToUrl, searchParams, router, pathname]
  );

  // Set page
  const setPage = useCallback(
    (page: number) => {
      setState((prev) => {
        const newPage = Math.max(1, page);
        updateUrl(newPage, prev.pageSize);
        return { ...prev, page: newPage };
      });
    },
    [updateUrl]
  );

  // Set page size
  const setPageSize = useCallback(
    (pageSize: number) => {
      setState((prev) => {
        // Reset to page 1 when changing page size
        updateUrl(1, pageSize);
        return { ...prev, pageSize, page: 1 };
      });
    },
    [updateUrl]
  );

  // Set total items
  const setTotalItems = useCallback((totalItems: number) => {
    setState((prev) => {
      const totalPages = Math.max(1, Math.ceil(totalItems / prev.pageSize));
      const page = Math.min(prev.page, totalPages);
      return { ...prev, totalItems, page };
    });
  }, []);

  // Navigation helpers
  const goToFirstPage = useCallback(() => setPage(1), [setPage]);
  const goToLastPage = useCallback(() => {
    const totalPages = Math.max(1, Math.ceil(state.totalItems / state.pageSize));
    setPage(totalPages);
  }, [setPage, state.totalItems, state.pageSize]);
  const goToNextPage = useCallback(() => {
    if (paginationInfo.hasNextPage) {
      setPage(paginationInfo.page + 1);
    }
  }, [setPage, paginationInfo.hasNextPage, paginationInfo.page]);
  const goToPrevPage = useCallback(() => {
    if (paginationInfo.hasPrevPage) {
      setPage(paginationInfo.page - 1);
    }
  }, [setPage, paginationInfo.hasPrevPage, paginationInfo.page]);

  // Reset pagination
  const reset = useCallback(() => {
    setState({ page: 1, pageSize: initialPageSize, totalItems: 0 });
    updateUrl(1, initialPageSize);
  }, [initialPageSize, updateUrl]);

  // Paginate data array (client-side)
  const paginateData = useCallback(
    <T>(data: T[]): T[] => {
      const { startIndex, endIndex } = paginationInfo;
      return data.slice(startIndex, endIndex);
    },
    [paginationInfo]
  );

  // Generate page numbers for display
  const getPageNumbers = useCallback(
    (maxVisible: number = 5): (number | "ellipsis")[] => {
      const { page, totalPages } = paginationInfo;
      const pages: (number | "ellipsis")[] = [];

      if (totalPages <= maxVisible) {
        // Show all pages
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Show first, last, and pages around current
        const sidePages = Math.floor((maxVisible - 3) / 2);
        const startPage = Math.max(2, page - sidePages);
        const endPage = Math.min(totalPages - 1, page + sidePages);

        pages.push(1);

        if (startPage > 2) {
          pages.push("ellipsis");
        }

        for (let i = startPage; i <= endPage; i++) {
          pages.push(i);
        }

        if (endPage < totalPages - 1) {
          pages.push("ellipsis");
        }

        if (totalPages > 1) {
          pages.push(totalPages);
        }
      }

      return pages;
    },
    [paginationInfo]
  );

  return {
    // State
    ...paginationInfo,

    // Setters
    setPage,
    setPageSize,
    setTotalItems,

    // Navigation
    goToFirstPage,
    goToLastPage,
    goToNextPage,
    goToPrevPage,

    // Utilities
    reset,
    paginateData,
    getPageNumbers,
    pageSizeOptions,
  };
}
