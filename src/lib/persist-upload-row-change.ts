import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

export type UploadRowChange =
  | { originalName: string; franchiseeId: string; addAsAlias: boolean }
  | { originalName: string; blacklist: true; notes?: string };

export interface UploadRowChangeResult {
  /** false = nothing was persisted; the page must not show the change. */
  ok: boolean;
  /** Server confirmation, shown as a success toast. */
  message?: string;
  /** Change applied, but the alias was not learned — the next file will miss again. */
  warning?: string;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

async function errorText(response: Response): Promise<string | undefined> {
  const body = await response.json().catch(() => ({}));
  return typeof body?.error === "string" ? body.error : undefined;
}

/**
 * Persist a match/blacklist change made on the upload-results table.
 *
 * Before the file is saved the change rides along with the save, so only the
 * alias needs writing now. Once the file is saved — and the anomaly dialog
 * saves the moment it is confirmed — a change kept in page state never reaches
 * the DB (יוניקו, 2026-10-18: two corrected rows lost on four uploads), so it
 * goes to the saved file, which also re-syncs its commissions.
 */
export async function persistUploadRowChange(
  savedFileId: string | null,
  change: UploadRowChange,
  fetcher: Fetcher = fetchWithTimeout
): Promise<UploadRowChangeResult> {
  if (savedFileId) {
    const response = await fetcher(`/api/supplier-files/review/${savedFileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // The upload screen promises "every row fixed → auto-approved", even
      // when the anomaly dialog already saved the file as needs_review
      body: JSON.stringify({ ...change, reevaluateStatus: true }),
    });
    if (!response.ok) {
      console.error("Saved-file row change failed:", response.status);
      return { ok: false, message: (await errorText(response)) ?? "שמירת השינוי בקובץ נכשלה" };
    }
    const data = await response.json().catch(() => ({}));
    return { ok: true, message: typeof data?.message === "string" ? data.message : undefined };
  }

  if (!("franchiseeId" in change) || !change.addAsAlias) return { ok: true };

  const response = await fetcher(`/api/franchisees/${change.franchiseeId}/aliases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alias: change.originalName }),
  });
  // 400 = the franchisee already has this alias — nothing to learn.
  if (response.ok || response.status === 400) return { ok: true };
  console.error("Failed to add alias:", response.status);
  // 409 carries a Hebrew message naming the franchisee that owns the alias.
  const warning = response.status === 409 ? await errorText(response) : undefined;
  return { ok: true, warning: warning ?? `הכינוי "${change.originalName}" לא נשמר` };
}
