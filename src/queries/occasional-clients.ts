import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { OccasionalClient } from "@/db/schema";

interface ListOptions {
  includeIgnored?: boolean;
}

export const occasionalClientKeys = {
  all: ["occasional-clients"] as const,
  list: (opts?: ListOptions) =>
    [...occasionalClientKeys.all, "list", opts?.includeIgnored ?? false] as const,
  needingNames: (franchiseeId: string, periodMonth: number, periodYear: number) =>
    [
      ...occasionalClientKeys.all,
      "needing-names",
      franchiseeId,
      periodMonth,
      periodYear,
    ] as const,
};

export interface OccasionalClientNeedingName {
  id: string;
  tabitColumnName: string;
  totalAmount: number;
}

export interface OccasionalNeedingNamesResponse {
  count: number;
  items: OccasionalClientNeedingName[];
}

async function fetchOccasionalClients(
  opts?: ListOptions
): Promise<OccasionalClient[]> {
  const params = new URLSearchParams();
  if (opts?.includeIgnored) params.set("includeIgnored", "true");
  const url = `/api/admin/occasional-clients${
    params.toString() ? `?${params}` : ""
  }`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch occasional clients");
  const body = await res.json();
  return body.data;
}

export function useOccasionalClients(opts?: ListOptions) {
  return useQuery({
    queryKey: occasionalClientKeys.list(opts),
    queryFn: () => fetchOccasionalClients(opts),
  });
}

export function useOccasionalClientsNeedingNames(
  franchiseeId: string,
  periodMonth: number,
  periodYear: number
) {
  return useQuery({
    queryKey: occasionalClientKeys.needingNames(franchiseeId, periodMonth, periodYear),
    queryFn: async (): Promise<OccasionalNeedingNamesResponse> => {
      const params = new URLSearchParams({
        franchiseeId,
        periodMonth: String(periodMonth),
        periodYear: String(periodYear),
      });
      const res = await fetch(
        `/api/admin/occasional-clients/needing-names?${params}`
      );
      if (!res.ok) throw new Error("שגיאה בטעינת לקוחות מזדמנים");
      const body = await res.json();
      return body.data as OccasionalNeedingNamesResponse;
    },
    enabled: !!franchiseeId && periodMonth > 0 && periodYear > 0,
  });
}

export interface UpdateOccasionalClientInput {
  id: string;
  patch: {
    hashavshevetName?: string | null;
    ignored?: boolean;
    notes?: string | null;
  };
}

export function useUpdateOccasionalClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdateOccasionalClientInput) => {
      const res = await fetch(`/api/admin/occasional-clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update occasional client");
      }
      const body = await res.json();
      return body.data as OccasionalClient;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: occasionalClientKeys.all });
    },
  });
}

export interface LinkOccasionalClientInput {
  id: string;
  clientId: string;
  addAlias?: boolean;
}

export interface LinkOccasionalClientResult {
  occasionalClientId: string;
  clientId: string;
  documentsCreated: number;
  documentsUpdated: number;
}

export interface DeleteOccasionalClientResult {
  tabitColumnName: string;
  documentsDeleted: number;
}

export function useDeleteOccasionalClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<DeleteOccasionalClientResult> => {
      const res = await fetch(`/api/admin/occasional-clients/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "שגיאה במחיקת לקוח מזדמן");
      }
      const body = await res.json();
      return body.data as DeleteOccasionalClientResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: occasionalClientKeys.all });
    },
  });
}

export function useLinkOccasionalClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      clientId,
      addAlias = true,
    }: LinkOccasionalClientInput) => {
      const res = await fetch(`/api/admin/occasional-clients/${id}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, addAlias }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to link occasional client");
      }
      const body = await res.json();
      return body.data as LinkOccasionalClientResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: occasionalClientKeys.all });
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
  });
}
