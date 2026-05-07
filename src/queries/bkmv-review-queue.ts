import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { useQuery } from "@tanstack/react-query";

export interface BkmvReviewQueueItem {
  id: string;
  fileName: string;
  fileSize: number;
  fileUrl: string;
  processingStatus: string;
  periodStartDate: string | null;
  periodEndDate: string | null;
  createdAt: string;
  franchisee: {
    id: string;
    name: string;
    code: string;
  } | null;
  matchStats: {
    total: number;
    exactMatches: number;
    fuzzyMatches: number;
    unmatched: number;
  } | null;
  companyId: string | null;
}

interface BkmvHistoryResponse {
  files: BkmvReviewQueueItem[];
  total: number;
  limit: number;
  offset: number;
}

export const bkmvReviewQueueKeys = {
  all: ["bkmvdata", "review-queue"] as const,
  list: (franchiseeId?: string) =>
    [...bkmvReviewQueueKeys.all, "list", franchiseeId ?? null] as const,
  count: () => [...bkmvReviewQueueKeys.all, "count"] as const,
};

async function fetchReviewQueue(
  franchiseeId?: string
): Promise<BkmvHistoryResponse> {
  const params = new URLSearchParams({
    status: "needs_review",
    limit: "100",
  });
  if (franchiseeId) {
    params.set("franchiseeId", franchiseeId);
  }
  const res = await fetchWithTimeout(`/api/bkmvdata/history?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch BKMV review queue");
  return res.json();
}

async function fetchReviewQueueCount(): Promise<number> {
  const params = new URLSearchParams({
    status: "needs_review",
    limit: "1",
  });
  const res = await fetchWithTimeout(`/api/bkmvdata/history?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch BKMV review queue count");
  const data: BkmvHistoryResponse = await res.json();
  return data.total;
}

export function useBkmvReviewQueue(franchiseeId?: string, enabled = true) {
  return useQuery({
    queryKey: bkmvReviewQueueKeys.list(franchiseeId),
    queryFn: () => fetchReviewQueue(franchiseeId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}

export function useBkmvReviewQueueCount() {
  return useQuery({
    queryKey: bkmvReviewQueueKeys.count(),
    queryFn: fetchReviewQueueCount,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
