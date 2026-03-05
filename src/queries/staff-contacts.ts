import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { StaffRole } from "@/db/schema";

interface StaffContactFilters {
  brandId?: string;
  role?: StaffRole;
}

export const staffContactKeys = {
  all: ["staff-contacts"] as const,
  lists: () => [...staffContactKeys.all, "list"] as const,
  filteredList: (filters: StaffContactFilters) =>
    [...staffContactKeys.lists(), filters] as const,
  details: () => [...staffContactKeys.all, "detail"] as const,
  detail: (id: string) => [...staffContactKeys.details(), id] as const,
};

async function fetchStaffContacts(filters?: StaffContactFilters) {
  const params = new URLSearchParams();
  if (filters?.brandId) params.set("brandId", filters.brandId);
  if (filters?.role) params.set("role", filters.role);

  const url = `/api/staff-contacts${params.toString() ? `?${params}` : ""}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error("Failed to fetch staff contacts");
  const data = await res.json();
  return data.staffContacts;
}

export function useStaffContacts(filters?: StaffContactFilters) {
  return useQuery({
    queryKey: filters
      ? staffContactKeys.filteredList(filters)
      : staffContactKeys.lists(),
    queryFn: () => fetchStaffContacts(filters),
  });
}

export function useCreateStaffContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetchWithTimeout("/api/staff-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to create staff contact");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: staffContactKeys.all });
    },
  });
}

export function useUpdateStaffContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Record<string, unknown>;
    }) => {
      const res = await fetchWithTimeout(`/api/staff-contacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to update staff contact");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: staffContactKeys.all });
    },
  });
}

export function useDeleteStaffContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithTimeout(`/api/staff-contacts/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to delete staff contact");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: staffContactKeys.all });
    },
  });
}
