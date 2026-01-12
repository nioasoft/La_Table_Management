import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const franchiseeReminderKeys = {
  all: ["franchisee-reminders"] as const,
  lists: () => [...franchiseeReminderKeys.all, "list"] as const,
  detail: (id: string) => [...franchiseeReminderKeys.all, "detail", id] as const,
};

export function useFranchiseeReminders() {
  return useQuery({
    queryKey: franchiseeReminderKeys.lists(),
    queryFn: async () => {
      const res = await fetch("/api/franchisee-reminders");
      if (!res.ok) throw new Error("Failed to fetch franchisee reminders");
      const data = await res.json();
      return data.reminders;
    },
  });
}

export function useCreateFranchiseeReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch("/api/franchisee-reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create franchisee reminder");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: franchiseeReminderKeys.all });
    },
  });
}

export function useUpdateFranchiseeReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await fetch(`/api/franchisee-reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update franchisee reminder");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: franchiseeReminderKeys.all });
    },
  });
}

export function useDeleteFranchiseeReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/franchisee-reminders/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete franchisee reminder");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: franchiseeReminderKeys.all });
    },
  });
}
