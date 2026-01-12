import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const supplierKeys = {
  all: ["suppliers"] as const,
  lists: () => [...supplierKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) => [...supplierKeys.lists(), filters] as const,
  details: () => [...supplierKeys.all, "detail"] as const,
  detail: (id: string) => [...supplierKeys.details(), id] as const,
};

async function fetchSuppliers() {
  const res = await fetch("/api/suppliers");
  if (!res.ok) throw new Error("Failed to fetch suppliers");
  const data = await res.json();
  return data.suppliers;
}

async function fetchSupplier(id: string) {
  const res = await fetch(`/api/suppliers/${id}`);
  if (!res.ok) throw new Error("Failed to fetch supplier");
  const data = await res.json();
  return data.supplier;
}

export function useSuppliers() {
  return useQuery({
    queryKey: supplierKeys.lists(),
    queryFn: fetchSuppliers,
  });
}

export function useSupplier(id: string) {
  return useQuery({
    queryKey: supplierKeys.detail(id),
    queryFn: () => fetchSupplier(id),
    enabled: !!id,
  });
}

export function useCreateSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create supplier");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplierKeys.all });
    },
  });
}

export function useUpdateSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await fetch(`/api/suppliers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update supplier");
      return res.json();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: supplierKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: supplierKeys.lists() });
    },
  });
}

export function useDeleteSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/suppliers/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete supplier");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplierKeys.all });
    },
  });
}
