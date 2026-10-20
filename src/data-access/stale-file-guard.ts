import { database } from "@/db";
import { supplierFileUpload, type SupplierFileProcessingResult } from "@/db/schema";
import { and, desc, eq, lt, ne } from "drizzle-orm";
import { createCustomError } from "@/lib/file-processing-errors";
import type { FileProcessingResult } from "@/lib/file-processor";
import type { PeriodRange } from "@/lib/sheet-period";

export interface EarlierFile {
  fileName: string;
  periodStart: string;
  periodEnd: string;
  matches: Pick<SupplierFileProcessingResult["franchiseeMatches"][number], "originalName" | "netAmount" | "matchType">[];
}

const amountsKey = (amounts: number[]): string =>
  amounts.map(Math.round).sort((a, b) => a - b).join(",");

/**
 * First earlier-period file whose amounts equal this file's row for row (to
 * the shekel, any order). Rows the earlier file blacklisted ("Totals") are
 * left out on both sides. A history scan of every upload (2026-10-20) found
 * exactly one such pair: רסטרטו Q3-2026 read from the Q2 tab.
 */
export function findIdenticalEarlierFile(
  rows: { franchisee: string; netAmount: number }[],
  earlier: EarlierFile[]
): EarlierFile | null {
  for (const file of earlier) {
    const skip = new Set(file.matches.filter((m) => m.matchType === "blacklisted").map((m) => m.originalName));
    const current = rows.filter((r) => !skip.has(r.franchisee)).map((r) => r.netAmount);
    const previous = file.matches.filter((m) => !skip.has(m.originalName)).map((m) => m.netAmount);
    // ponytail: one-row files skipped — a fixed monthly amount may legitimately repeat
    if (current.length >= 2 && amountsKey(current) === amountsKey(previous)) return file;
  }
  return null;
}

async function getEarlierPeriodFiles(supplierId: string, before: string): Promise<EarlierFile[]> {
  const rows = await database
    .select({
      fileName: supplierFileUpload.originalFileName,
      periodStart: supplierFileUpload.periodStartDate,
      periodEnd: supplierFileUpload.periodEndDate,
      result: supplierFileUpload.processingResult,
    })
    .from(supplierFileUpload)
    .where(
      and(
        eq(supplierFileUpload.supplierId, supplierId),
        ne(supplierFileUpload.processingStatus, "rejected"),
        lt(supplierFileUpload.periodEndDate, before)
      )
    )
    .orderBy(desc(supplierFileUpload.periodStartDate))
    .limit(6);
  return rows.map((r) => ({
    fileName: r.fileName,
    periodStart: r.periodStart ?? "",
    periodEnd: r.periodEnd ?? "",
    matches: r.result?.franchiseeMatches ?? [],
  }));
}

const displayDate = (ymd: string): string => ymd.split("-").reverse().join("/");

/**
 * Refuses a parse whose amounts repeat an earlier period's file — a stale file
 * (or a stale tab) re-sent as the new period. Refusing, not warning: every
 * upload path (admin, link, reprocess) treats a failed parse as "not saved",
 * so no commission is ever created from it.
 */
export async function blockIfSameAsEarlierPeriod(
  result: FileProcessingResult,
  context: { supplierId?: string; period?: PeriodRange } | undefined
): Promise<FileProcessingResult> {
  if (!context?.supplierId || !context.period || !result.success || result.data.length < 2) return result;
  const same = findIdenticalEarlierFile(
    result.data,
    await getEarlierPeriodFiles(context.supplierId, context.period.start)
  );
  if (!same) return result;

  const messageHe =
    `הסכומים בקובץ זהים אחד-לאחד לקובץ "${same.fileName}" של התקופה ` +
    `${displayDate(same.periodStart)}–${displayDate(same.periodEnd)}. ` +
    "כנראה נשלח קובץ (או גיליון) של תקופה קודמת. לא נקלט כלום — יש לבקש מהספק את הקובץ הנכון.";
  return {
    ...result,
    success: false,
    data: [],
    errors: [...result.errors, createCustomError("SAME_AS_EARLIER_PERIOD", "validation", "error", messageHe, { details: messageHe })],
    anomalies: [
      ...(result.anomalies ?? []),
      {
        code: "SAME_AS_EARLIER_PERIOD",
        severity: "blocking",
        messageHe,
        details: { earlierFile: same.fileName, earlierPeriodStart: same.periodStart, earlierPeriodEnd: same.periodEnd },
        suggestedActions: [{ type: "reject_file", labelHe: "ביטול" }],
      },
    ],
  };
}
