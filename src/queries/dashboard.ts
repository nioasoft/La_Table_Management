import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { useQuery } from "@tanstack/react-query";

export const dashboardKeys = {
  all: ["dashboard"] as const,
  stats: () => [...dashboardKeys.all, "stats"] as const,
  periodStatus: () => [...dashboardKeys.all, "periodStatus"] as const,
  uploadStatus: () => [...dashboardKeys.all, "uploadStatus"] as const,
  commissionSettlement: () => [...dashboardKeys.all, "commissionSettlement"] as const,
  upcomingReminders: () => [...dashboardKeys.all, "upcomingReminders"] as const,
  supplierCompleteness: () => [...dashboardKeys.all, "supplierCompleteness"] as const,
};

export function useDashboardStats() {
  return useQuery({
    queryKey: dashboardKeys.stats(),
    queryFn: async () => {
      const res = await fetchWithTimeout("/api/dashboard/stats");
      if (!res.ok) throw new Error("Failed to fetch dashboard stats");
      const data = await res.json();
      return data.stats;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function usePeriodStatus(periodStart?: string, periodEnd?: string) {
  return useQuery({
    queryKey: [...dashboardKeys.periodStatus(), periodStart, periodEnd],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (periodStart) params.set("periodStart", periodStart);
      if (periodEnd) params.set("periodEnd", periodEnd);
      const qs = params.toString();
      const url = `/api/dashboard/period-status${qs ? `?${qs}` : ""}`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error("Failed to fetch period status");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useUploadStatus(periodStart?: string, periodEnd?: string) {
  return useQuery({
    queryKey: [...dashboardKeys.uploadStatus(), periodStart, periodEnd],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (periodStart) params.set("periodStart", periodStart);
      if (periodEnd) params.set("periodEnd", periodEnd);
      const qs = params.toString();
      const url = `/api/dashboard/upload-status${qs ? `?${qs}` : ""}`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error("Failed to fetch upload status");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
    enabled: !!periodStart && !!periodEnd,
  });
}

export function useCommissionSettlementStatus(periodStart?: string, periodEnd?: string) {
  return useQuery({
    queryKey: [...dashboardKeys.commissionSettlement(), periodStart, periodEnd],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (periodStart) params.set("periodStart", periodStart);
      if (periodEnd) params.set("periodEnd", periodEnd);
      const qs = params.toString();
      const url = `/api/dashboard/commission-settlement-status${qs ? `?${qs}` : ""}`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error("Failed to fetch commission settlement status");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useUpcomingReminders(daysAhead = 30, limit = 10) {
  return useQuery({
    queryKey: [...dashboardKeys.upcomingReminders(), daysAhead, limit],
    queryFn: async () => {
      const res = await fetchWithTimeout(`/api/dashboard/upcoming-reminders?daysAhead=${daysAhead}&limit=${limit}`);
      if (!res.ok) throw new Error("Failed to fetch upcoming reminders");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useSupplierCompleteness(
  year?: number,
  periodStart?: string,
  periodEnd?: string,
  currentDue?: boolean,
  frequency?: string
) {
  const currentYear = year || new Date().getFullYear();
  return useQuery({
    queryKey: [...dashboardKeys.supplierCompleteness(), currentYear, periodStart, periodEnd, currentDue, frequency],
    queryFn: async () => {
      const params = new URLSearchParams({ year: String(currentYear) });
      if (currentDue) {
        params.set("currentDue", "true");
      } else {
        if (periodStart) params.set("periodStart", periodStart);
        if (periodEnd) params.set("periodEnd", periodEnd);
      }
      if (frequency) params.set("frequency", frequency);
      const res = await fetchWithTimeout(`/api/dashboard/supplier-completeness?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch supplier completeness");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
