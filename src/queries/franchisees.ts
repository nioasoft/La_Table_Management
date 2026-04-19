import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const franchiseeKeys = {
  all: ["franchisees"] as const,
  lists: () => [...franchiseeKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) => [...franchiseeKeys.lists(), filters] as const,
  details: () => [...franchiseeKeys.all, "detail"] as const,
  detail: (id: string) => [...franchiseeKeys.details(), id] as const,
};

type FranchiseeCategoryFilter = "regular" | "other" | "all";

interface UseFranchiseesFilters {
  category?: FranchiseeCategoryFilter;
}

async function fetchFranchisees(filters: UseFranchiseesFilters = {}) {
  const params = new URLSearchParams();
  if (filters.category && filters.category !== "regular") {
    params.set("category", filters.category);
  }
  const qs = params.toString();
  const res = await fetchWithTimeout(`/api/franchisees${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch franchisees");
  const data = await res.json();
  return data.franchisees;
}

async function fetchFranchisee(id: string) {
  const res = await fetchWithTimeout(`/api/franchisees/${id}`);
  if (!res.ok) throw new Error("Failed to fetch franchisee");
  const data = await res.json();
  return data.franchisee;
}

export function useFranchisees(filters: UseFranchiseesFilters = {}) {
  const normalized: UseFranchiseesFilters = {
    category: filters.category ?? "regular",
  };
  return useQuery({
    queryKey: franchiseeKeys.list(normalized as Record<string, unknown>),
    queryFn: () => fetchFranchisees(normalized),
  });
}

export function useFranchisee(id: string) {
  return useQuery({
    queryKey: franchiseeKeys.detail(id),
    queryFn: () => fetchFranchisee(id),
    enabled: !!id,
  });
}

export function useCreateFranchisee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetchWithTimeout("/api/franchisees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create franchisee");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: franchiseeKeys.all });
    },
  });
}

export function useUpdateFranchisee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await fetchWithTimeout(`/api/franchisees/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update franchisee");
      return res.json();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: franchiseeKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: franchiseeKeys.lists() });
    },
  });
}

export function useDeleteFranchisee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithTimeout(`/api/franchisees/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete franchisee");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: franchiseeKeys.all });
    },
  });
}
