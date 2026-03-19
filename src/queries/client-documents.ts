import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ClientDocumentWithDetails, TrackingMatrixRow } from "@/data-access/client-documents";

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const clientDocumentKeys = {
  all: ["client-documents"] as const,
  lists: () => [...clientDocumentKeys.all, "list"] as const,
  list: (filters: ClientDocumentListFilters) =>
    [...clientDocumentKeys.lists(), filters] as const,
  details: () => [...clientDocumentKeys.all, "detail"] as const,
  detail: (id: string) => [...clientDocumentKeys.details(), id] as const,
  matrix: (periodMonth: number, periodYear: number) =>
    [...clientDocumentKeys.all, "matrix", periodMonth, periodYear] as const,
  summary: (periodMonth: number, periodYear: number) =>
    [...clientDocumentKeys.all, "summary", periodMonth, periodYear] as const,
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClientDocumentListFilters {
  clientId?: string;
  franchiseeId?: string;
  documentType?: string;
  periodMonth?: number;
  periodYear?: number;
}

interface PeriodSummary {
  totalDocuments: number;
  clientReports: number;
  tabitReports: number;
  pending: number;
  approved: number;
  needsReview: number;
}

// ─── Fetch Functions ─────────────────────────────────────────────────────────

async function fetchDocuments(
  filters: ClientDocumentListFilters
): Promise<ClientDocumentWithDetails[]> {
  const params = new URLSearchParams({ view: "list" });
  if (filters.clientId) params.set("clientId", filters.clientId);
  if (filters.franchiseeId) params.set("franchiseeId", filters.franchiseeId);
  if (filters.documentType) params.set("documentType", filters.documentType);
  if (filters.periodMonth !== undefined)
    params.set("periodMonth", String(filters.periodMonth));
  if (filters.periodYear !== undefined)
    params.set("periodYear", String(filters.periodYear));

  const res = await fetch(`/api/clients/documents?${params}`);
  if (!res.ok) throw new Error("שגיאה בטעינת מסמכים");
  return res.json();
}

async function fetchMatrix(
  periodMonth: number,
  periodYear: number
): Promise<TrackingMatrixRow[]> {
  const params = new URLSearchParams({
    view: "matrix",
    periodMonth: String(periodMonth),
    periodYear: String(periodYear),
  });
  const res = await fetch(`/api/clients/documents?${params}`);
  if (!res.ok) throw new Error("שגיאה בטעינת מטריצת מעקב");
  return res.json();
}

async function fetchPeriodSummary(
  periodMonth: number,
  periodYear: number
): Promise<PeriodSummary> {
  const params = new URLSearchParams({
    view: "summary",
    periodMonth: String(periodMonth),
    periodYear: String(periodYear),
  });
  const res = await fetch(`/api/clients/documents?${params}`);
  if (!res.ok) throw new Error("שגיאה בטעינת סיכום");
  return res.json();
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useClientDocuments(filters: ClientDocumentListFilters) {
  return useQuery({
    queryKey: clientDocumentKeys.list(filters),
    queryFn: () => fetchDocuments(filters),
  });
}

export function useDocumentTrackingMatrix(
  periodMonth: number,
  periodYear: number
) {
  return useQuery({
    queryKey: clientDocumentKeys.matrix(periodMonth, periodYear),
    queryFn: () => fetchMatrix(periodMonth, periodYear),
    enabled: periodMonth > 0 && periodYear > 0,
  });
}

export function useDocumentPeriodSummary(
  periodMonth: number,
  periodYear: number
) {
  return useQuery({
    queryKey: clientDocumentKeys.summary(periodMonth, periodYear),
    queryFn: () => fetchPeriodSummary(periodMonth, periodYear),
    enabled: periodMonth > 0 && periodYear > 0,
  });
}

export function useUploadClientDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/clients/documents", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "שגיאה בהעלאת מסמך");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientDocumentKeys.all });
    },
  });
}

export function useUpdateDocumentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      processingStatus,
      reviewNotes,
    }: {
      id: string;
      processingStatus?: string;
      reviewNotes?: string;
    }) => {
      const res = await fetch(`/api/clients/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processingStatus, reviewNotes }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "שגיאה בעדכון מסמך");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientDocumentKeys.all });
    },
  });
}

export function useDeleteClientDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/clients/documents/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "שגיאה במחיקת מסמך");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientDocumentKeys.all });
    },
  });
}
