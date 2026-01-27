"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { SettlementPeriodType } from "@/db/schema";
import { getPeriodByKey } from "@/lib/settlement-periods";

// ============================================================================
// TYPES
// ============================================================================

export interface FilterOption {
  id: string;
  name?: string;
  nameHe?: string;
  nameEn?: string | null;
  code?: string;
}

export interface ReportFilters {
  startDate: string;
  endDate: string;
  brandId: string;
  supplierId: string;
  franchiseeId: string;
  status: string;
  searchTerm: string;
  /** Period type for period selector */
  periodType: SettlementPeriodType | "";
  /** Period key (e.g., "2025-Q4", "2025-01") */
  periodKey: string;
}

export interface FilterOptions {
  brands: FilterOption[];
  suppliers: FilterOption[];
  franchisees: FilterOption[];
}

export interface UseReportFiltersOptions {
  /** Sync filters to URL search params */
  syncToUrl?: boolean;
  /** Initial filter values */
  initialFilters?: Partial<ReportFilters>;
  /** Available filter options */
  filterOptions?: FilterOptions;
}

// ============================================================================
// HOOK
// ============================================================================

const defaultFilters: ReportFilters = {
  startDate: "",
  endDate: "",
  brandId: "",
  supplierId: "",
  franchiseeId: "",
  status: "",
  searchTerm: "",
  periodType: "",
  periodKey: "",
};

export function useReportFilters(hookOptions: UseReportFiltersOptions = {}) {
  const { syncToUrl = false, initialFilters = {}, filterOptions } = hookOptions;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Track if we should sync URL (to avoid initial sync on mount)
  const shouldSyncUrl = useRef(false);

  // Initialize filters from URL or defaults
  const getInitialFilters = useCallback((): ReportFilters => {
    if (syncToUrl) {
      // Try to restore from periodKey first
      const periodKey = searchParams.get("periodKey") || initialFilters.periodKey || "";
      const periodType = (searchParams.get("periodType") || initialFilters.periodType || "") as SettlementPeriodType | "";

      let startDate = searchParams.get("startDate") || initialFilters.startDate || "";
      let endDate = searchParams.get("endDate") || initialFilters.endDate || "";

      // If we have a periodKey but no dates, derive dates from the period
      if (periodKey && (!startDate || !endDate)) {
        const period = getPeriodByKey(periodKey);
        if (period) {
          startDate = period.startDate.toISOString().split("T")[0];
          endDate = period.endDate.toISOString().split("T")[0];
        }
      }

      return {
        startDate,
        endDate,
        brandId: searchParams.get("brandId") || initialFilters.brandId || "",
        supplierId: searchParams.get("supplierId") || initialFilters.supplierId || "",
        franchiseeId: searchParams.get("franchiseeId") || initialFilters.franchiseeId || "",
        status: searchParams.get("status") || initialFilters.status || "",
        searchTerm: searchParams.get("search") || initialFilters.searchTerm || "",
        periodType,
        periodKey,
      };
    }
    return { ...defaultFilters, ...initialFilters };
  }, [syncToUrl, searchParams, initialFilters]);

  const [filters, setFilters] = useState<ReportFilters>(getInitialFilters);
  const [options, setOptions] = useState<FilterOptions>(
    filterOptions || { brands: [], suppliers: [], franchisees: [] }
  );

  // Sync filters to URL using useEffect (fixes React warning)
  useEffect(() => {
    if (!syncToUrl || !shouldSyncUrl.current) return;

    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== "all" && value !== "") {
        params.set(key === "searchTerm" ? "search" : key, value);
      }
    });

    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [filters, syncToUrl, pathname, router]);

  // Update a single filter
  const updateFilter = useCallback(
    <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => {
      shouldSyncUrl.current = true;
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  // Update multiple filters at once
  const updateFilters = useCallback(
    (updates: Partial<ReportFilters>) => {
      shouldSyncUrl.current = true;
      setFilters((prev) => ({ ...prev, ...updates }));
    },
    []
  );

  // Update period (sets periodType, periodKey, startDate, and endDate)
  const updatePeriod = useCallback(
    (periodType: SettlementPeriodType | "", periodKey: string) => {
      shouldSyncUrl.current = true;

      if (!periodKey || !periodType) {
        // Clear period selection
        setFilters((prev) => ({
          ...prev,
          periodType: "",
          periodKey: "",
        }));
        return;
      }

      const period = getPeriodByKey(periodKey);
      if (period) {
        setFilters((prev) => ({
          ...prev,
          periodType,
          periodKey,
          startDate: period.startDate.toISOString().split("T")[0],
          endDate: period.endDate.toISOString().split("T")[0],
        }));
      }
    },
    []
  );

  // Reset all filters
  const resetFilters = useCallback(() => {
    shouldSyncUrl.current = true;
    setFilters(defaultFilters);
  }, []);

  // Build query string for API calls
  const buildQueryString = useCallback((): string => {
    const params = new URLSearchParams();

    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
    if (filters.brandId && filters.brandId !== "all") params.set("brandId", filters.brandId);
    if (filters.supplierId && filters.supplierId !== "all") params.set("supplierId", filters.supplierId);
    if (filters.franchiseeId && filters.franchiseeId !== "all") params.set("franchiseeId", filters.franchiseeId);
    if (filters.status && filters.status !== "all") params.set("status", filters.status);
    if (filters.searchTerm) params.set("search", filters.searchTerm);
    // Include period info for reference (API can use dates directly)
    if (filters.periodType) params.set("periodType", filters.periodType);
    if (filters.periodKey) params.set("periodKey", filters.periodKey);

    return params.toString();
  }, [filters]);

  // Check if any filter is active (excluding period metadata since dates are the actual filter)
  const hasActiveFilters = useMemo(() => {
    return Object.entries(filters).some(([key, value]) => {
      // Skip period metadata fields - dates are what matter
      if (key === "periodType" || key === "periodKey") return false;
      if (key === "searchTerm") return value.trim() !== "";
      return value !== "" && value !== "all";
    });
  }, [filters]);

  // Count active filters (excluding period metadata)
  const activeFilterCount = useMemo(() => {
    return Object.entries(filters).filter(([key, value]) => {
      // Skip period metadata fields
      if (key === "periodType" || key === "periodKey") return false;
      if (key === "searchTerm") return value.trim() !== "";
      return value !== "" && value !== "all";
    }).length;
  }, [filters]);

  return {
    filters,
    setFilters,
    updateFilter,
    updateFilters,
    updatePeriod,
    resetFilters,
    buildQueryString,
    hasActiveFilters,
    activeFilterCount,
    options,
    setOptions,
  };
}

// ============================================================================
// DATE PRESET HELPERS
// ============================================================================

export interface DatePreset {
  label: string;
  startDate: string;
  endDate: string;
}

/**
 * Get current month date range
 */
export function getCurrentMonthRange(): DatePreset {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const startDate = new Date(year, month, 1).toISOString().split("T")[0];
  const endDate = new Date(year, month + 1, 0).toISOString().split("T")[0];

  return { label: "החודש הנוכחי", startDate, endDate };
}

/**
 * Get previous month date range
 */
export function getPreviousMonthRange(): DatePreset {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const startDate = new Date(year, month - 1, 1).toISOString().split("T")[0];
  const endDate = new Date(year, month, 0).toISOString().split("T")[0];

  return { label: "החודש הקודם", startDate, endDate };
}

/**
 * Get current quarter date range
 */
export function getCurrentQuarterRange(): DatePreset {
  const now = new Date();
  const year = now.getFullYear();
  const quarter = Math.floor(now.getMonth() / 3);

  const startDate = new Date(year, quarter * 3, 1).toISOString().split("T")[0];
  const endDate = new Date(year, quarter * 3 + 3, 0).toISOString().split("T")[0];

  return { label: "הרבעון הנוכחי", startDate, endDate };
}

/**
 * Get previous quarter date range
 */
export function getPreviousQuarterRange(): DatePreset {
  const now = new Date();
  const year = now.getFullYear();
  const quarter = Math.floor(now.getMonth() / 3);
  const prevQuarter = quarter - 1;
  const prevYear = prevQuarter < 0 ? year - 1 : year;
  const adjustedQuarter = prevQuarter < 0 ? 3 : prevQuarter;

  const startDate = new Date(prevYear, adjustedQuarter * 3, 1).toISOString().split("T")[0];
  const endDate = new Date(prevYear, adjustedQuarter * 3 + 3, 0).toISOString().split("T")[0];

  return { label: "הרבעון הקודם", startDate, endDate };
}

/**
 * Get current year date range (year-to-date)
 */
export function getCurrentYearRange(): DatePreset {
  const now = new Date();
  const year = now.getFullYear();

  const startDate = new Date(year, 0, 1).toISOString().split("T")[0];
  const endDate = now.toISOString().split("T")[0];

  return { label: "מתחילת השנה", startDate, endDate };
}

/**
 * Get all date presets
 */
export function getDatePresets(): DatePreset[] {
  return [
    getCurrentMonthRange(),
    getPreviousMonthRange(),
    getCurrentQuarterRange(),
    getPreviousQuarterRange(),
    getCurrentYearRange(),
  ];
}
