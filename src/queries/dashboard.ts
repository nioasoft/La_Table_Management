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
      const res = await fetch("/api/dashboard/stats");
      if (!res.ok) throw new Error("Failed to fetch dashboard stats");
      const data = await res.json();
      return data.stats;
    },
  });
}

export function usePeriodStatus() {
  return useQuery({
    queryKey: dashboardKeys.periodStatus(),
    queryFn: async () => {
      const res = await fetch("/api/dashboard/period-status");
      if (!res.ok) throw new Error("Failed to fetch period status");
      return res.json();
    },
  });
}

export function useUploadStatus() {
  return useQuery({
    queryKey: dashboardKeys.uploadStatus(),
    queryFn: async () => {
      const res = await fetch("/api/dashboard/upload-status");
      if (!res.ok) throw new Error("Failed to fetch upload status");
      return res.json();
    },
  });
}

export function useCommissionSettlementStatus() {
  return useQuery({
    queryKey: dashboardKeys.commissionSettlement(),
    queryFn: async () => {
      const res = await fetch("/api/dashboard/commission-settlement-status");
      if (!res.ok) throw new Error("Failed to fetch commission settlement status");
      return res.json();
    },
  });
}

export function useUpcomingReminders(daysAhead = 30, limit = 10) {
  return useQuery({
    queryKey: [...dashboardKeys.upcomingReminders(), daysAhead, limit],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/upcoming-reminders?daysAhead=${daysAhead}&limit=${limit}`);
      if (!res.ok) throw new Error("Failed to fetch upcoming reminders");
      return res.json();
    },
  });
}

export function useSupplierCompleteness(year?: number) {
  const currentYear = year || new Date().getFullYear();
  return useQuery({
    queryKey: [...dashboardKeys.supplierCompleteness(), currentYear],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/supplier-completeness?year=${currentYear}`);
      if (!res.ok) throw new Error("Failed to fetch supplier completeness");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}
