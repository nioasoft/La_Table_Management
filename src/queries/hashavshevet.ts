import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ClientPreview, ExpectedRow, SendFailure } from "@/components/hashavshevet/preview-state";
import type { SendData } from "@/app/api/hashavshevet/send/route";
import type { CompanySendResult } from "@/lib/hashavshevet/send-flow";
import { previewCopy } from "@/lib/hashavshevet/copy";
import type { exportParamsSchema } from "@/schemas/hashavshevet";
import type { z } from "zod";

/** `{ exportType, params }` as each export button builds it (schema inputs: defaults may be omitted). */
export type ExportRequest = z.input<typeof exportParamsSchema>;
export type SendRequest = ExportRequest & { expected: ExpectedRow[] };

export const hashavshevetKeys = {
  all: ["hashavshevet"] as const,
  awaitingCount: () => [...hashavshevetKeys.all, "awaiting-count"] as const,
};

/** A non-2xx answer (or a network failure, status 0). 409/422 may carry sends that already went out. */
export class HashavshevetApiError extends Error implements SendFailure {
  constructor(
    message: string,
    readonly status: number,
    readonly sends?: CompanySendResult[],
  ) {
    super(message);
    this.name = "HashavshevetApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    console.error("Hashavshevet request failed to reach the server", { url, err });
    throw new HashavshevetApiError(previewCopy.requestFailed, 0);
  }
  const body: { success?: boolean; data?: T & Partial<SendData>; error?: string } | null = await res
    .json()
    .catch(() => null);
  if (!res.ok || !body?.success) {
    console.error("Hashavshevet request rejected", { url, status: res.status, error: body?.error });
    throw new HashavshevetApiError(body?.error ?? previewCopy.requestFailed, res.status, body?.data?.sends);
  }
  return body.data as T;
}

function postJson<T>(url: string, payload: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** The preview is a POST (it carries the export params) but never writes: a mutation only for its shape. */
export function usePreviewMutation() {
  return useMutation<ClientPreview, HashavshevetApiError, ExportRequest>({
    mutationFn: (req) => postJson<ClientPreview>("/api/hashavshevet/preview", req),
  });
}

export function useSendMutation() {
  const queryClient = useQueryClient();
  return useMutation<SendData, HashavshevetApiError, SendRequest>({
    mutationFn: (req) => postJson<SendData>("/api/hashavshevet/send", req),
    // Also on failure: a 409 can follow companies that were already sent.
    onSettled: () => queryClient.invalidateQueries({ queryKey: hashavshevetKeys.all }),
  });
}

/** Sends waiting for Reut's approval in Hashavshevet; feeds the sidebar badge. */
export function useAwaitingCount() {
  return useQuery({
    queryKey: hashavshevetKeys.awaitingCount(),
    queryFn: async () => (await request<{ count: number }>("/api/hashavshevet/sends?count=awaiting")).count,
    staleTime: 30_000,
  });
}
