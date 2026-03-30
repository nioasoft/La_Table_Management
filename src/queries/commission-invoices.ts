import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  InvoiceVerificationRow,
  InvoiceVerificationSummaryRow,
} from "@/data-access/commission-invoices";

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const commissionInvoiceKeys = {
  all: ["commission-invoices"] as const,
  summary: (periodMonth: number, periodYear: number) =>
    [...commissionInvoiceKeys.all, "summary", periodMonth, periodYear] as const,
  verification: (
    clientId: string,
    periodMonth: number,
    periodYear: number
  ) =>
    [
      ...commissionInvoiceKeys.all,
      "verification",
      clientId,
      periodMonth,
      periodYear,
    ] as const,
};

// ─── Fetch Functions ─────────────────────────────────────────────────────────

async function fetchVerificationSummary(
  periodMonth: number,
  periodYear: number
): Promise<InvoiceVerificationSummaryRow[]> {
  const params = new URLSearchParams({
    periodMonth: String(periodMonth),
    periodYear: String(periodYear),
  });
  const res = await fetch(`/api/clients/commission-invoices?${params}`);
  if (!res.ok) throw new Error("שגיאה בטעינת סיכום אימות חשבוניות");
  const data = await res.json();
  return data.summary;
}

async function fetchVerification(
  clientId: string,
  periodMonth: number,
  periodYear: number
): Promise<InvoiceVerificationRow[]> {
  const params = new URLSearchParams({
    clientId,
    periodMonth: String(periodMonth),
    periodYear: String(periodYear),
  });
  const res = await fetch(`/api/clients/commission-invoices?${params}`);
  if (!res.ok) throw new Error("שגיאה בטעינת נתוני אימות");
  const data = await res.json();
  return data.rows;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

export function useInvoiceVerificationSummary(
  periodMonth: number,
  periodYear: number
) {
  return useQuery({
    queryKey: commissionInvoiceKeys.summary(periodMonth, periodYear),
    queryFn: () => fetchVerificationSummary(periodMonth, periodYear),
  });
}

export function useInvoiceVerification(
  clientId: string | null,
  periodMonth: number,
  periodYear: number
) {
  return useQuery({
    queryKey: commissionInvoiceKeys.verification(
      clientId ?? "",
      periodMonth,
      periodYear
    ),
    queryFn: () => fetchVerification(clientId!, periodMonth, periodYear),
    enabled: !!clientId,
  });
}

export function useUploadCommissionInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/clients/documents", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "שגיאה בהעלאת חשבונית");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: commissionInvoiceKeys.all,
      });
    },
  });
}
