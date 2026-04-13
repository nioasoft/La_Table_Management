import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { OccasionalClient } from "@/db/schema";

interface ListOptions {
  includeIgnored?: boolean;
}

export const occasionalClientKeys = {
  all: ["occasional-clients"] as const,
  list: (opts?: ListOptions) =>
    [...occasionalClientKeys.all, "list", opts?.includeIgnored ?? false] as const,
};

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

export interface UpdateOccasionalClientInput {
  id: string;
  patch: {
    hashavshevetCode?: string | null;
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
