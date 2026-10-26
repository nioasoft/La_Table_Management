import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ClientPreview, ExpectedRow, SendFailure } from "@/components/hashavshevet/preview-state";
import type { SendData } from "@/app/api/hashavshevet/send/route";
import type { SendListItem } from "@/app/api/hashavshevet/sends/route";
import type { CompanyRow, MappingsOverview, SendDetail, SendDetailRow } from "@/data-access/hashavshevet";
import type { CompanySendResult } from "@/lib/hashavshevet/send-flow";
import { previewCopy } from "@/lib/hashavshevet/copy";
import type { exportParamsSchema } from "@/schemas/hashavshevet";
import type { z } from "zod";

/** `{ exportType, params }` as each export button builds it (schema inputs: defaults may be omitted). */
export type ExportRequest = z.input<typeof exportParamsSchema>;
export type SendRequest = ExportRequest & { expected: ExpectedRow[] };

/** What a store type looks like after JSON: Dates arrive as ISO strings. */
type Wire<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] };

export type CompanyDto = CompanyRow;
export type MappingsDto = MappingsOverview;
export type SendDto = Wire<SendListItem>;
export type SendDetailDto = Omit<Wire<SendDetail>, "rows"> & { rows: Array<Wire<SendDetailRow>> };

export interface CompanyPatch {
  liveFrom?: string | null;
  requiresApproval?: boolean;
}
export interface MappingPatch {
  kind: "brand" | "franchisee";
  id: string;
  companyId: string | null;
}
export interface ResolveRequest {
  sendId: string;
  outcome: "approved" | "rejected" | "arrived";
  note?: string;
}

export const hashavshevetKeys = {
  all: ["hashavshevet"] as const,
  awaitingCount: () => [...hashavshevetKeys.all, "awaiting-count"] as const,
  companies: () => [...hashavshevetKeys.all, "companies"] as const,
  mappings: () => [...hashavshevetKeys.all, "mappings"] as const,
  sends: () => [...hashavshevetKeys.all, "sends"] as const,
  sendDetail: (id: string) => [...hashavshevetKeys.all, "send", id] as const,
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

function sendJson<T>(method: "POST" | "PATCH", url: string, payload: unknown): Promise<T> {
  return request<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const postJson = <T>(url: string, payload: unknown) => sendJson<T>("POST", url, payload);

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
export function useAwaitingCount(enabled = true) {
  return useQuery({
    queryKey: hashavshevetKeys.awaitingCount(),
    queryFn: async () => (await request<{ count: number }>("/api/hashavshevet/sends?count=awaiting")).count,
    staleTime: 30_000,
    enabled,
  });
}

export function useCompanies() {
  return useQuery({
    queryKey: hashavshevetKeys.companies(),
    queryFn: async () => (await request<{ companies: CompanyDto[] }>("/api/hashavshevet/companies")).companies,
  });
}

export function useMappings() {
  return useQuery({
    queryKey: hashavshevetKeys.mappings(),
    queryFn: () => request<MappingsDto>("/api/hashavshevet/mappings"),
  });
}

/** Every send, newest first (the server caps the list); the screen splits queue and history itself. */
export function useSends() {
  return useQuery({
    queryKey: hashavshevetKeys.sends(),
    queryFn: async () => (await request<{ sends: SendDto[] }>("/api/hashavshevet/sends")).sends,
  });
}

export function useSendDetail(sendId: string | null) {
  return useQuery({
    queryKey: hashavshevetKeys.sendDetail(sendId ?? ""),
    queryFn: async () =>
      (await request<{ send: SendDetailDto }>(`/api/hashavshevet/sends/${encodeURIComponent(sendId ?? "")}`)).send,
    enabled: sendId !== null,
  });
}

/** Admin writes all refresh everything under ["hashavshevet"]: lists, detail and the sidebar badge. */
function useInvalidatingMutation<V>(mutationFn: (vars: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation<unknown, HashavshevetApiError, V>({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: hashavshevetKeys.all }),
  });
}

export function usePatchCompany() {
  return useInvalidatingMutation(({ id, patch }: { id: string; patch: CompanyPatch }) =>
    sendJson("PATCH", `/api/hashavshevet/companies/${encodeURIComponent(id)}`, patch),
  );
}

export function usePatchMapping() {
  return useInvalidatingMutation((patch: MappingPatch) => sendJson("PATCH", "/api/hashavshevet/mappings", patch));
}

export function useResolveSend() {
  return useInvalidatingMutation(({ sendId, ...body }: ResolveRequest) =>
    postJson(`/api/hashavshevet/sends/${encodeURIComponent(sendId)}/resolve`, body),
  );
}

export function useUnlockRow() {
  return useInvalidatingMutation(({ rowId, reason }: { rowId: string; reason: string }) =>
    postJson(`/api/hashavshevet/rows/${encodeURIComponent(rowId)}/unlock`, { reason }),
  );
}
