import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const clientReconciliationKeys = {
  all: ["client-reconciliation"] as const,
  sessions: () => [...clientReconciliationKeys.all, "sessions"] as const,
  sessionList: (clientId?: string) =>
    [...clientReconciliationKeys.sessions(), clientId] as const,
  session: (sessionId: string) =>
    [...clientReconciliationKeys.all, "session", sessionId] as const,
};

export function useClientReconciliationSessions(clientId?: string) {
  return useQuery({
    queryKey: clientReconciliationKeys.sessionList(clientId),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (clientId) params.set("clientId", clientId);
      const res = await fetch(`/api/clients/reconciliation?${params}`);
      if (!res.ok) throw new Error("שגיאה בטעינת התאמות");
      return res.json();
    },
  });
}

export function useClientReconciliationSession(sessionId: string) {
  return useQuery({
    queryKey: clientReconciliationKeys.session(sessionId),
    queryFn: async () => {
      const res = await fetch(`/api/clients/reconciliation/${sessionId}`);
      if (!res.ok) throw new Error("שגיאה בטעינת התאמה");
      return res.json();
    },
    enabled: !!sessionId,
  });
}

export function useCreateClientReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      clientId: string;
      periodMonth: number;
      periodYear: number;
    }) => {
      const res = await fetch("/api/clients/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "שגיאה ביצירת התאמה");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: clientReconciliationKeys.all,
      });
    },
  });
}

export function useApproveSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/clients/reconciliation/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "שגיאה באישור התאמה");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: clientReconciliationKeys.all,
      });
    },
  });
}

export function useUpdateComparisonStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      reviewNotes,
    }: {
      id: string;
      status: string;
      reviewNotes?: string;
    }) => {
      const res = await fetch(
        `/api/clients/reconciliation/comparisons/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, reviewNotes }),
        }
      );
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "שגיאה בעדכון השוואה");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: clientReconciliationKeys.all,
      });
    },
  });
}
