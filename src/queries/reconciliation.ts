import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const reconciliationKeys = {
  all: ["reconciliation"] as const,
  lists: () => [...reconciliationKeys.all, "list"] as const,
  discrepancies: () => [...reconciliationKeys.all, "discrepancies"] as const,
  detail: (id: string) => [...reconciliationKeys.all, "detail", id] as const,
};

export function useReconciliation(params?: { stats?: boolean }) {
  const queryParams = new URLSearchParams();
  if (params?.stats) queryParams.set("stats", "true");

  return useQuery({
    queryKey: [...reconciliationKeys.lists(), params],
    queryFn: async () => {
      const url = `/api/reconciliation${queryParams.toString() ? `?${queryParams}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch reconciliation data");
      return res.json();
    },
  });
}

export function useDiscrepancies() {
  return useQuery({
    queryKey: reconciliationKeys.discrepancies(),
    queryFn: async () => {
      const res = await fetch("/api/reconciliation/discrepancies");
      if (!res.ok) throw new Error("Failed to fetch discrepancies");
      return res.json();
    },
  });
}

export function useCrossReference(id: string) {
  return useQuery({
    queryKey: reconciliationKeys.detail(id),
    queryFn: async () => {
      const res = await fetch(`/api/reconciliation/${id}`);
      if (!res.ok) throw new Error("Failed to fetch cross reference");
      return res.json();
    },
    enabled: !!id,
  });
}

export function useResolveCrossReference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await fetch(`/api/reconciliation/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to resolve cross reference");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reconciliationKeys.all });
    },
  });
}

export function useBulkCompare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { periodStartDate: string; periodEndDate: string; threshold?: number }) => {
      const res = await fetch("/api/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to perform bulk comparison");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reconciliationKeys.all });
    },
  });
}
