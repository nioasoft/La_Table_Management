/**
 * Custom parser for הולי קראק פאי (supplier code "קראק") customer ledgers.
 *
 * One CSV per branch — "דוח תנועות לקוח" exported from the supplier's
 * bookkeeping, windows-1255 encoded (first seen Sep 2026):
 *   סוג מסמך/תנועה | אסמכתא 1 | אסמכתא 2 | תאריך ערך | … | חובה (ש״ח) | זכות (ש״ח) | יתרה
 *   - "יתרת פתיחה" first, "סה״כ" last.
 *   - Sales = tax invoices (חובה) minus credit notes (זכות). Receipts are
 *     payments, not sales — ignored.
 *
 * ⚠ The branch name is NOT in the file — only in the filename
 * ("ויני_עזריאלי_דוח_תנועות_לקוח.csv"). Every processing path must pass the
 * original filename; without it the parser fails rather than guess.
 *
 * Ledger debits are invoice totals INCL. VAT (same as the Yama Vekadma
 * כרטסת): net = gross / (1 + vatRate). Rows keep their invoice date, so the
 * upload route's period check flags invoices outside the chosen quarter.
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  ISRAEL_VAT_RATE,
  roundAmount,
} from "../file-processor";
import {
  type FileProcessingError,
  createFileProcessingError,
} from "../file-processing-errors";

const HEADER_SCAN_ROWS = 10;
const DOC_TYPE_HEADER = "סוג מסמך";
/** Rows that are neither a sale nor something to warn about */
const IGNORED_DOC_TYPES = ["יתרת פתיחה", "קבלה"];
const TOTAL_ROW_RE = /^סה["״]?כ/;

/** cp1255 is the supplier's export default; accept UTF-8 if they ever switch */
function decode(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1255").decode(buffer);
  }
}

/** "ויני_כרמיאל__דוח_תנועות_לקוח (1).csv" → "ויני כרמיאל" */
function branchFromFileName(fileName: string | undefined): string {
  return (fileName ?? "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\s*\(\d+\)$/, "")
    .replace(/_/g, " ")
    .replace(/דוח\s+תנועות\s+לקוח/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "2026-09-09" or "09/09/2026" → local Date (never toISOString — Israel TZ) */
function parseDate(value: string): Date | null {
  let m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = value.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}

function toNumber(value: unknown): number {
  const parsed = parseFloat(String(value ?? "").replace(/[,₪\s]/g, ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

const cellText = (value: unknown): string => String(value ?? "").trim();

export function parseCrackPieFile(
  buffer: Buffer,
  vatRate: number = ISRAEL_VAT_RATE,
  fileName?: string
): FileProcessingResult {
  const errors: FileProcessingError[] = [];
  const warnings: FileProcessingError[] = [];
  const data: ParsedRowData[] = [];
  const fail = (code: "HEADER_ROW_NOT_FOUND" | "MISSING_FRANCHISEE_COLUMN" | "FILE_TYPE_MISMATCH" | "PARSE_ERROR" | "SYSTEM_ERROR", details: string, totalRows = 0) => {
    errors.push(createFileProcessingError(code, { details }));
    return createResult(false, data, errors, warnings, totalRows);
  };

  if (buffer.subarray(0, 2).toString("latin1") === "PK") {
    return fail("FILE_TYPE_MISMATCH", "ZIP/XLSX received — upload each branch's CSV ledger file itself");
  }

  const franchisee = branchFromFileName(fileName);
  if (!franchisee) {
    return fail("MISSING_FRANCHISEE_COLUMN", `Branch name not found in filename "${fileName ?? ""}" — the ledger file itself has no customer name`);
  }

  try {
    const workbook = XLSX.read(decode(buffer), { type: "string", raw: true });
    const rows: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1,
      raw: true,
      defval: "",
    });

    const headerIdx = rows
      .slice(0, HEADER_SCAN_ROWS)
      .findIndex((r) => (r || []).some((c) => cellText(c).startsWith(DOC_TYPE_HEADER)));
    if (headerIdx === -1) {
      return fail("HEADER_ROW_NOT_FOUND", `Ledger header with a "${DOC_TYPE_HEADER}/תנועה" column not found`, rows.length);
    }

    const header = rows[headerIdx].map(cellText);
    const typeCol = header.findIndex((h) => h.startsWith(DOC_TYPE_HEADER));
    const dateCol = header.findIndex((h) => h.startsWith("תאריך"));
    const debitCol = header.findIndex((h) => h.startsWith("חובה"));
    const creditCol = header.findIndex((h) => h.startsWith("זכות"));
    if (dateCol === -1 || debitCol === -1 || creditCol === -1) {
      return fail("HEADER_ROW_NOT_FOUND", `Missing תאריך / חובה / זכות column in header: ${header.join(" | ")}`, rows.length);
    }

    let invoiceDebits = 0;
    let fileTotalDebit: number | null = null;
    let skippedRows = 0;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const docType = cellText(row[typeCol]);
      const debit = toNumber(row[debitCol]);
      const credit = toNumber(row[creditCol]);

      if (TOTAL_ROW_RE.test(docType)) {
        fileTotalDebit = debit;
        continue;
      }

      let gross: number;
      if (docType.includes("זיכוי")) gross = -credit;
      else if (docType.includes("חשבונית")) gross = debit;
      else {
        if (docType && !IGNORED_DOC_TYPES.some((t) => docType.startsWith(t))) {
          warnings.push(createFileProcessingError("ROW_PARSE_ERROR", { details: `Unknown document type "${docType}" skipped`, rowNumber: i + 1 }));
        }
        skippedRows++;
        continue;
      }
      if (!gross) {
        skippedRows++;
        continue;
      }

      if (gross > 0) invoiceDebits += gross;
      const date = parseDate(cellText(row[dateCol]));
      if (!date) {
        warnings.push(createFileProcessingError("INVALID_DATE", { details: `Unreadable date "${cellText(row[dateCol])}"`, rowNumber: i + 1 }));
      }

      data.push({
        franchisee,
        date,
        grossAmount: roundAmount(gross),
        netAmount: roundAmount(gross / (1 + vatRate)),
        originalAmount: roundAmount(gross),
        rowNumber: i + 1,
      });
    }

    if (fileTotalDebit !== null && Math.abs(fileTotalDebit - invoiceDebits) > 1) {
      warnings.push(createFileProcessingError("GRAND_TOTAL_MISMATCH", { details: `Tax invoices sum to ${invoiceDebits} but the file's סה״כ חובה is ${fileTotalDebit}` }));
    }

    if (data.length === 0) {
      return fail("PARSE_ERROR", "No tax invoices found in the ledger", rows.length);
    }

    return createResult(true, data, errors, warnings, rows.length, skippedRows);
  } catch (error) {
    return fail("SYSTEM_ERROR", error instanceof Error ? error.message : "Unknown error");
  }
}

function createResult(
  success: boolean,
  data: ParsedRowData[],
  errors: FileProcessingError[],
  warnings: FileProcessingError[],
  totalRows: number,
  skippedRows = 0
): FileProcessingResult {
  return {
    success,
    data,
    errors,
    warnings,
    legacyErrors: errors.map((e) => e.details ?? e.message),
    legacyWarnings: warnings.map((w) => w.details ?? w.message),
    summary: {
      totalRows,
      processedRows: data.length,
      skippedRows,
      totalGrossAmount: data.reduce((t, r) => t + r.grossAmount, 0),
      totalNetAmount: data.reduce((t, r) => t + r.netAmount, 0),
      vatAdjusted: true,
    },
  };
}
