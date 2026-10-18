import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { useQuery } from "@tanstack/react-query";
import type { SupplierFileUploadWithSupplier } from "@/data-access/supplier-file-uploads";

export const supplierFileUploadKeys = {
  all: ["supplier-file-uploads"] as const,
  lists: () => [...supplierFileUploadKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) =>
    [...supplierFileUploadKeys.lists(), filters] as const,
  bySupplier: (supplierId: string, filters?: Record<string, unknown>) =>
    [...supplierFileUploadKeys.lists(), { supplierId, ...filters }] as const,
  reviewCount: () =>
    [...supplierFileUploadKeys.all, "review", "count"] as const,
};

/** YYYY-MM-DD local dates of a settlement period. */
export interface UploadPeriodRange {
  start: string;
  end: string;
}

interface SupplierFileUploadsResponse {
  files: SupplierFileUploadWithSupplier[];
  total: number;
}

async function fetchSupplierFileUploads(
  supplierId?: string,
  limit?: number,
  period?: UploadPeriodRange
): Promise<SupplierFileUploadsResponse> {
  const params = new URLSearchParams();
  if (supplierId) params.set("supplierId", supplierId);
  if (limit) params.set("limit", String(limit));
  if (period) {
    params.set("periodStart", period.start);
    params.set("periodEnd", period.end);
  }

  const res = await fetchWithTimeout(
    `/api/supplier-files?${params.toString()}`
  );
  if (!res.ok) throw new Error("Failed to fetch supplier file uploads");
  return res.json();
}

/**
 * Hook to fetch upload history for a specific supplier.
 * With `period`, only files whose period overlaps it.
 */
export function useSupplierUploadHistory(
  supplierId: string,
  options?: { limit?: number; enabled?: boolean; period?: UploadPeriodRange }
) {
  const limit = options?.limit ?? 10;
  return useQuery({
    queryKey: supplierFileUploadKeys.bySupplier(supplierId, {
      limit,
      period: options?.period,
    }),
    queryFn: () => fetchSupplierFileUploads(supplierId, limit, options?.period),
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
      const res = await fetchWithTimeout("/api/supplier-files/review/count");
      if (!res.ok) throw new Error("Failed to fetch review count");
      const data = await res.json();
      return data.count as number;
    },
  });
}
