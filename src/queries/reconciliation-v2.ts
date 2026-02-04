/**
 * TanStack Query Hooks for Reconciliation V2 Module
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  SupplierWithFileInfo,
  SupplierPeriod,
  ReconciliationSessionWithDetails,
  ReconciliationComparisonWithDetails,
  ReconciliationReviewQueueItem,
  ReconciliationHistoryItem,
  ReconciliationComparisonStatus,
} from "@/types/reconciliation-v2";

// ============================================================================
// QUERY KEYS
// ============================================================================

export const reconciliationV2Keys = {
  all: ["reconciliation-v2"] as const,
  suppliers: () => [...reconciliationV2Keys.all, "suppliers"] as const,
  supplierPeriods: (supplierId: string) =>
    [...reconciliationV2Keys.all, "periods", supplierId] as const,
  sessions: () => [...reconciliationV2Keys.all, "sessions"] as const,
  session: (sessionId: string) =>
    [...reconciliationV2Keys.sessions(), sessionId] as const,
  sessionWithComparisons: (sessionId: string) =>
    [...reconciliationV2Keys.session(sessionId), "comparisons"] as const,
  reviewQueue: () => [...reconciliationV2Keys.all, "review-queue"] as const,
  reviewQueueCount: () =>
    [...reconciliationV2Keys.reviewQueue(), "count"] as const,
  history: (filters?: Record<string, unknown>) =>
    [...reconciliationV2Keys.all, "history", filters] as const,
  sessionsList: (filters?: Record<string, unknown>) =>
    [...reconciliationV2Keys.sessions(), "list", filters] as const,
};

// ============================================================================
// API FUNCTIONS
// ============================================================================

async function fetchSuppliersWithFiles(): Promise<SupplierWithFileInfo[]> {
  const res = await fetch("/api/reconciliation-v2/suppliers");
  if (!res.ok) throw new Error("Failed to fetch suppliers");
  return res.json();
}

async function fetchSupplierPeriods(
  supplierId: string
): Promise<SupplierPeriod[]> {
  const res = await fetch(
    `/api/reconciliation-v2/suppliers/${supplierId}/periods`
  );
  if (!res.ok) throw new Error("Failed to fetch periods");
  return res.json();
}

async function fetchSession(
  sessionId: string
): Promise<ReconciliationSessionWithDetails> {
  const res = await fetch(`/api/reconciliation-v2/sessions/${sessionId}`);
  if (!res.ok) throw new Error("Failed to fetch session");
  return res.json();
}

async function fetchSessionWithComparisons(sessionId: string): Promise<{
  session: ReconciliationSessionWithDetails;
  comparisons: ReconciliationComparisonWithDetails[];
}> {
  const res = await fetch(
    `/api/reconciliation-v2/sessions/${sessionId}?include=comparisons`
  );
  if (!res.ok) throw new Error("Failed to fetch session with comparisons");
  return res.json();
}

async function fetchReviewQueueItems(): Promise<ReconciliationReviewQueueItem[]> {
  const res = await fetch("/api/reconciliation-v2/review-queue");
  if (!res.ok) throw new Error("Failed to fetch review queue");
  return res.json();
}

async function fetchReviewQueueCount(): Promise<number> {
  const res = await fetch("/api/reconciliation-v2/review-queue/count");
  if (!res.ok) throw new Error("Failed to fetch review queue count");
  const data = await res.json();
  return data.count;
}

async function fetchHistory(filters?: {
  supplierId?: string;
  franchiseeId?: string;
  periodStartDate?: string;
  periodEndDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: ReconciliationHistoryItem[]; total: number }> {
  const params = new URLSearchParams();
  if (filters?.supplierId) params.set("supplierId", filters.supplierId);
  if (filters?.franchiseeId) params.set("franchiseeId", filters.franchiseeId);
  if (filters?.periodStartDate)
    params.set("periodStartDate", filters.periodStartDate);
  if (filters?.periodEndDate)
    params.set("periodEndDate", filters.periodEndDate);
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.offset) params.set("offset", String(filters.offset));

  const res = await fetch(`/api/reconciliation-v2/history?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}

async function fetchSessionsList(filters?: {
  status?: string;
  supplierId?: string;
  limit?: number;
}): Promise<ReconciliationSessionWithDetails[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.supplierId) params.set("supplierId", filters.supplierId);
  if (filters?.limit) params.set("limit", String(filters.limit));

  const res = await fetch(`/api/reconciliation-v2/sessions?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Fetch suppliers that have uploaded files
 */
export function useReconciliationSuppliersWithFiles() {
  return useQuery({
    queryKey: reconciliationV2Keys.suppliers(),
    queryFn: fetchSuppliersWithFiles,
    staleTime: 60000, // 1 minute
  });
}

/**
 * Fetch available periods for a supplier
 */
export function useSupplierPeriods(
  supplierId: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: reconciliationV2Keys.supplierPeriods(supplierId || ""),
    queryFn: () => fetchSupplierPeriods(supplierId!),
    enabled: !!supplierId && options?.enabled !== false,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Fetch a single session
 */
export function useReconciliationSession(
  sessionId: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: reconciliationV2Keys.session(sessionId || ""),
    queryFn: () => fetchSession(sessionId!),
    enabled: !!sessionId && options?.enabled !== false,
  });
}

/**
 * Fetch session with all comparisons
 */
export function useReconciliationSessionWithComparisons(
  sessionId: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: reconciliationV2Keys.sessionWithComparisons(sessionId || ""),
    queryFn: () => fetchSessionWithComparisons(sessionId!),
    enabled: !!sessionId && options?.enabled !== false,
  });
}

/**
 * Fetch review queue items
 */
export function useReviewQueueItems() {
  return useQuery({
    queryKey: reconciliationV2Keys.reviewQueue(),
    queryFn: fetchReviewQueueItems,
    staleTime: 10000, // 10 seconds
  });
}

/**
 * Fetch review queue count (for sidebar badge)
 */
export function useReviewQueueCount() {
  return useQuery({
    queryKey: reconciliationV2Keys.reviewQueueCount(),
    queryFn: fetchReviewQueueCount,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Fetch reconciliation history with filters
 */
export function useReconciliationHistory(filters?: {
  supplierId?: string;
  franchiseeId?: string;
  periodStartDate?: string;
  periodEndDate?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: reconciliationV2Keys.history(filters),
    queryFn: () => fetchHistory(filters),
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Fetch all sessions (for sessions list page)
 */
export function useReconciliationSessions(filters?: {
  status?: string;
  supplierId?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: reconciliationV2Keys.sessionsList(filters),
    queryFn: () => fetchSessionsList(filters),
    staleTime: 30000, // 30 seconds
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Create a new reconciliation session
 */
export function useCreateReconciliationSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      supplierId: string;
      supplierFileId: string;
      periodStartDate: string;
      periodEndDate: string;
    }) => {
      const res = await fetch("/api/reconciliation-v2/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create session");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.sessions(),
      });
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.suppliers(),
      });
    },
  });
}

/**
 * Update comparison status
 */
export function useUpdateComparisonStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      comparisonId: string;
      status: ReconciliationComparisonStatus;
      notes?: string;
    }) => {
      const res = await fetch(
        `/api/reconciliation-v2/comparisons/${data.comparisonId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: data.status, notes: data.notes }),
        }
      );
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update comparison");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.sessions(),
      });
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.reviewQueue(),
      });
    },
  });
}

/**
 * Bulk approve comparisons
 */
export function useBulkApproveComparisons() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { comparisonIds: string[] }) => {
      const res = await fetch("/api/reconciliation-v2/comparisons/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to bulk approve");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.sessions(),
      });
    },
  });
}

/**
 * Add comparison to review queue
 */
export function useAddToReviewQueue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { comparisonId: string; sessionId: string }) => {
      const res = await fetch(
        `/api/reconciliation-v2/comparisons/${data.comparisonId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "sent_to_review_queue",
            sessionId: data.sessionId,
          }),
        }
      );
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to add to review queue");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.sessions(),
      });
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.reviewQueue(),
      });
    },
  });
}

/**
 * Resolve review queue item
 */
export function useResolveReviewQueueItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { queueItemId: string; notes?: string }) => {
      const res = await fetch(
        `/api/reconciliation-v2/review-queue/${data.queueItemId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: data.notes }),
        }
      );
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to resolve queue item");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.reviewQueue(),
      });
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.sessions(),
      });
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.history(),
      });
    },
  });
}

/**
 * Approve session file
 */
export function useApproveSessionFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/reconciliation-v2/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to approve file");
      }
      return res.json();
    },
    onSuccess: (_, sessionId) => {
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.session(sessionId),
      });
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.sessions(),
      });
    },
  });
}

/**
 * Reject session file
 */
export function useRejectSessionFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      sessionId: string;
      reason: string;
      sendEmail?: boolean;
    }) => {
      const res = await fetch(
        `/api/reconciliation-v2/sessions/${data.sessionId}/reject-email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: data.reason,
            sendEmail: data.sendEmail,
          }),
        }
      );
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to reject file");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.session(variables.sessionId),
      });
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.sessions(),
      });
    },
  });
}

/**
 * Delete a reconciliation session
 */
export function useDeleteReconciliationSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/reconciliation-v2/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to delete session");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.sessions(),
      });
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.suppliers(),
      });
      // Also invalidate all periods since session state changed
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "reconciliation-v2" &&
          query.queryKey[1] === "periods",
      });
    },
  });
}
