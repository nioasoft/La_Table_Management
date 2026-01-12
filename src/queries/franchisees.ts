import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const franchiseeKeys = {
  all: ["franchisees"] as const,
  lists: () => [...franchiseeKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) => [...franchiseeKeys.lists(), filters] as const,
  details: () => [...franchiseeKeys.all, "detail"] as const,
  detail: (id: string) => [...franchiseeKeys.details(), id] as const,
};

async function fetchFranchisees() {
  const res = await fetch("/api/franchisees");
  if (!res.ok) throw new Error("Failed to fetch franchisees");
  const data = await res.json();
  return data.franchisees;
}

async function fetchFranchisee(id: string) {
  const res = await fetch(`/api/franchisees/${id}`);
  if (!res.ok) throw new Error("Failed to fetch franchisee");
  const data = await res.json();
  return data.franchisee;
}

export function useFranchisees() {
  return useQuery({
    queryKey: franchiseeKeys.lists(),
    queryFn: fetchFranchisees,
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
      const res = await fetch("/api/franchisees", {
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
      const res = await fetch(`/api/franchisees/${id}`, {
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
      const res = await fetch(`/api/franchisees/${id}`, {
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
