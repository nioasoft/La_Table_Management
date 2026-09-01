import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

/** A decision about one parsed row; a null franchisee drops the row. */
export interface BillingRowDecision {
  readonly rowIndex: number;
  readonly franchiseeId: string | null;
}

function apiErrorMessage(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }
  return null;
}

/**
 * Replays a workbook already stored — against the current settings, and
 * against any decision just made about a row that had blocked the month.
 * The amounts always come from the file itself; a decision only says who a
 * row belongs to, never how much it is.
 */
export async function reprocessSourceFile(
  sourceFileId: string,
  override?: BillingRowDecision,
): Promise<void> {
  const response = await fetchWithTimeout("/api/franchisee-billing/reprocess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceFileId, ...(override ? { override } : {}) }),
    timeout: 60_000,
  });
  const responseBody: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      apiErrorMessage(responseBody) ?? "עיבוד הקובץ מחדש נכשל. נסי שוב.",
    );
  }
}
