import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  SettlementSimpleReport,
  SettlementSimpleFilterOptions,
  SaveAdjustmentData,
} from "@/data-access/settlement-simple";

// Query keys
export const settlementSimpleKeys = {
  all: ["settlement-simple"] as const,
  report: (filters: SettlementSimpleFilters) =>
    [...settlementSimpleKeys.all, "report", filters] as const,
  filterOptions: () => [...settlementSimpleKeys.all, "filter-options"] as const,
};

// Filter type
export interface SettlementSimpleFilters {
  periodStartDate?: string;
  periodEndDate?: string;
  supplierId?: string;
  franchiseeId?: string;
  brandId?: string;
}

// API response type
export interface SettlementSimpleAPIResponse {
  report: SettlementSimpleReport | null;
  filterOptions: SettlementSimpleFilterOptions;
  periods: Array<{
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: string;
  }>;
}

/**
 * Hook to fetch settlement simple report and filter options
 */
export function useSettlementSimpleReport(filters: SettlementSimpleFilters) {
  const queryParams = new URLSearchParams();

  if (filters.periodStartDate) {
    queryParams.set("periodStartDate", filters.periodStartDate);
  }
  if (filters.periodEndDate) {
    queryParams.set("periodEndDate", filters.periodEndDate);
  }
  if (filters.supplierId) {
    queryParams.set("supplierId", filters.supplierId);
  }
  if (filters.franchiseeId) {
    queryParams.set("franchiseeId", filters.franchiseeId);
  }
  if (filters.brandId) {
    queryParams.set("brandId", filters.brandId);
  }

  return useQuery<SettlementSimpleAPIResponse>({
    queryKey: settlementSimpleKeys.report(filters),
    queryFn: async () => {
      const url = `/api/settlement-simple${queryParams.toString() ? `?${queryParams}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("Failed to fetch settlement report");
      }
      return res.json();
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to fetch filter options only (without period dates)
 */
export function useSettlementSimpleFilterOptions() {
  return useQuery<SettlementSimpleAPIResponse>({
    queryKey: settlementSimpleKeys.filterOptions(),
    queryFn: async () => {
      const res = await fetch("/api/settlement-simple");
      if (!res.ok) {
        throw new Error("Failed to fetch filter options");
      }
      return res.json();
    },
    staleTime: 1000 * 60 * 10, // 10 minutes
  });
}

/**
 * Mutation hook to save an adjustment
 */
export function useSaveSettlementAdjustment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Omit<SaveAdjustmentData, "createdBy">) => {
      const res = await fetch("/api/settlement-simple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to save adjustment");
      }

      return res.json();
    },
    onSuccess: () => {
      // Invalidate all settlement simple queries to refresh data
      queryClient.invalidateQueries({ queryKey: settlementSimpleKeys.all });
    },
  });
}

/**
 * Hook to export settlement report to Excel
 */
export function useExportSettlementSimple() {
  return useMutation({
    mutationFn: async (filters: SettlementSimpleFilters) => {
      const queryParams = new URLSearchParams();

      if (filters.periodStartDate) {
        queryParams.set("periodStartDate", filters.periodStartDate);
      }
      if (filters.periodEndDate) {
        queryParams.set("periodEndDate", filters.periodEndDate);
      }
      if (filters.supplierId) {
        queryParams.set("supplierId", filters.supplierId);
      }
      if (filters.franchiseeId) {
        queryParams.set("franchiseeId", filters.franchiseeId);
      }
      if (filters.brandId) {
        queryParams.set("brandId", filters.brandId);
      }

      const url = `/api/settlement-simple/export?${queryParams}`;
      const res = await fetch(url);

      if (!res.ok) {
        throw new Error("Failed to export report");
      }

      // Get the blob and create download
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);

      // Get filename from Content-Disposition header or use default
      const contentDisposition = res.headers.get("Content-Disposition");
      let filename = "settlement_report.xlsx";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) {
          filename = match[1];
        }
      }

      // Trigger download
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);

      return { success: true };
    },
  });
}
