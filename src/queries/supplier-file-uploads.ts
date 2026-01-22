import { useQuery } from "@tanstack/react-query";
import type { SupplierFileUploadWithSupplier } from "@/data-access/supplier-file-uploads";

export const supplierFileUploadKeys = {
  all: ["supplier-file-uploads"] as const,
  lists: () => [...supplierFileUploadKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) =>
    [...supplierFileUploadKeys.lists(), filters] as const,
  bySupplier: (supplierId: string) =>
    [...supplierFileUploadKeys.lists(), { supplierId }] as const,
  reviewCount: () => [...supplierFileUploadKeys.all, "review", "count"] as const,
};

interface SupplierFileUploadsResponse {
  files: SupplierFileUploadWithSupplier[];
  total: number;
}

async function fetchSupplierFileUploads(
  supplierId?: string,
  limit?: number
): Promise<SupplierFileUploadsResponse> {
  const params = new URLSearchParams();
  if (supplierId) params.set("supplierId", supplierId);
  if (limit) params.set("limit", String(limit));

  const res = await fetch(`/api/supplier-files?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch supplier file uploads");
  return res.json();
}

/**
 * Hook to fetch upload history for a specific supplier
 */
export function useSupplierUploadHistory(
  supplierId: string,
  options?: { limit?: number; enabled?: boolean }
) {
  return useQuery({
    queryKey: supplierFileUploadKeys.bySupplier(supplierId),
    queryFn: () => fetchSupplierFileUploads(supplierId, options?.limit ?? 10),
    enabled: options?.enabled !== false && !!supplierId,
  });
}

/**
 * Hook to fetch the review count for sidebar badge
 */
export function useSupplierFileReviewCount() {
  return useQuery({
    queryKey: supplierFileUploadKeys.reviewCount(),
    queryFn: async () => {
      const res = await fetch("/api/supplier-files/review/count");
      if (!res.ok) throw new Error("Failed to fetch review count");
      const data = await res.json();
      return data.count as number;
    },
  });
}
