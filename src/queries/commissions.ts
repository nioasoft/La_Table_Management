import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const commissionKeys = {
  all: ["commissions"] as const,
  lists: () => [...commissionKeys.all, "list"] as const,
  bySupplier: (supplierId: string) => [...commissionKeys.all, "supplier", supplierId] as const,
  byFranchisee: (franchiseeId: string) => [...commissionKeys.all, "franchisee", franchiseeId] as const,
  byBrand: (brandId: string) => [...commissionKeys.all, "brand", brandId] as const,
  invoice: () => [...commissionKeys.all, "invoice"] as const,
  detail: (id: string) => [...commissionKeys.all, "detail", id] as const,
};

export function useCommissions(params?: { supplierId?: string; franchiseeId?: string; periodStartDate?: string; periodEndDate?: string }) {
  const queryParams = new URLSearchParams();
  if (params?.supplierId) queryParams.set("supplierId", params.supplierId);
  if (params?.franchiseeId) queryParams.set("franchiseeId", params.franchiseeId);
  if (params?.periodStartDate) queryParams.set("periodStartDate", params.periodStartDate);
  if (params?.periodEndDate) queryParams.set("periodEndDate", params.periodEndDate);

  return useQuery({
    queryKey: [...commissionKeys.lists(), params],
    queryFn: async () => {
      const url = `/api/commissions${queryParams.toString() ? `?${queryParams}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch commissions");
      return res.json();
    },
  });
}

export function useCommissionsBySupplier(supplierId: string) {
  return useQuery({
    queryKey: commissionKeys.bySupplier(supplierId),
    queryFn: async () => {
      const res = await fetch(`/api/commissions/supplier/${supplierId}`);
      if (!res.ok) throw new Error("Failed to fetch supplier commissions");
      return res.json();
    },
    enabled: !!supplierId,
  });
}

export function useCommissionsByFranchisee(franchiseeId: string) {
  return useQuery({
    queryKey: commissionKeys.byFranchisee(franchiseeId),
    queryFn: async () => {
      const res = await fetch(`/api/commissions/franchisee/${franchiseeId}`);
      if (!res.ok) throw new Error("Failed to fetch franchisee commissions");
      return res.json();
    },
    enabled: !!franchiseeId,
  });
}

export function useCommissionsByBrand(brandId: string) {
  return useQuery({
    queryKey: commissionKeys.byBrand(brandId),
    queryFn: async () => {
      const res = await fetch(`/api/commissions/brand/${brandId}`);
      if (!res.ok) throw new Error("Failed to fetch brand commissions");
      return res.json();
    },
    enabled: !!brandId,
  });
}

export function useInvoiceCommissions() {
  return useQuery({
    queryKey: commissionKeys.invoice(),
    queryFn: async () => {
      const res = await fetch("/api/commissions/invoice");
      if (!res.ok) throw new Error("Failed to fetch invoice commissions");
      return res.json();
    },
  });
}

export function useCreateCommission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch("/api/commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create commission");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commissionKeys.all });
    },
  });
}

export function useUpdateCommission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await fetch(`/api/commissions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update commission");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commissionKeys.all });
    },
  });
}
