/**
 * Custom parser for מזרח ומערב (MIZRACH_UMAARAV) supplier files
 *
 * File structure (one sheet, one block per commission rate):
 *   - Title "קאסטרה 17% רבעון X" / "קאסטרה 10% רבעון X"
 *   - Header row: [שם סוכן,] מס' לקוח, שם לקוח, <months>, סכום כולל
 *   - Data rows, then a totals row with an empty name
 *   - The supplier's invoice line: "קוד : 600020 | הסכם 922 | 17% | 55,252.45"
 *
 * A header row opens a section — NOT the title. A manually edited Q3-2026 file
 * lost the 10% title, and the title-driven parser billed those rows at 17%.
 * The rate comes from the title, or else from the invoice line; a section with
 * neither (or with both disagreeing) fails the file. The invoice line's amount
 * is the supplier's own commission and is checked against ours.
 *
 * Same franchisee across sections → one row; preCalculatedCommission is the
 * blended Σ(amount × rate), since supplier.default_commission_rate can't mix.
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// VAT rate in Israel
const VAT_RATE = 0.18;

const TITLE_PERCENT = /(\d+(?:\.\d+)?)\s*%/; // inside "קאסטרה 10% רבעון 3 2026"
const BARE_PERCENT = /^(\d+(?:\.\d+)?)\s*%$/; // the invoice line's rate cell
const HEBREW = /[\u05D0-\u05EA]/;
// The file only says WHICH section is which — the rates are contractual
// (הסכם 922), never taken from the file. ponytail: hardcoded, move to supplier
// config if the agreement changes.
const CONTRACT_RATES = new Set([17, 10]);

interface Section {
  titleRate: number | null;
  invoiceRate: number | null;
  invoiceAmount: number | null; // the supplier's own commission for this section
  nameCol: number;
  totalCol: number;
  rows: { name: string; total: number }[];
}

/**
 * Parse currency string to number (handles parentheses for negative)
 */
function parseCurrency(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;

  let str = String(value).trim();

  // Handle negative numbers in parentheses: (1,234) -> -1234
  const isNegative = str.startsWith("(") && str.endsWith(")");
  if (isNegative) {
    str = str.slice(1, -1);
  }

  // Remove currency symbols, commas, spaces
  str = str.replace(/[₪,\s]/g, "");

  // Handle dash for zero
  if (str === "-" || str === "") return 0;

  const num = parseFloat(str);
  if (isNaN(num)) return 0;

  return isNegative ? -num : num;
}

/**
 * Walk the sheet once: a title (any column) closes the current section and
 * names the next one's rate, a header row opens a section, an invoice line
 * gives the section its fallback rate. Unusable sections are reported in
 * `broken` — a section billed at the wrong rate must never pass silently.
 */
function detectSections(data: unknown[][]): { sections: Section[]; broken: string[] } {
  const sections: Section[] = [];
  const broken: string[] = [];
  let current: Section | null = null;
  let pendingTitleRate: number | null = null;

  for (const raw of data) {
    const cells = (raw ?? []).map(c => String(c ?? "").trim());

    const title = cells.find(c => HEBREW.test(c) && TITLE_PERCENT.test(c));
    if (title) {
      if (pendingTitleRate !== null) broken.push(`כותרת ${pendingTitleRate}% בלי שורת כותרות עמודות`);
      pendingTitleRate = Number(title.match(TITLE_PERCENT)![1]);
      current = null;
      continue;
    }

    const nameCol = cells.findIndex(c => c.includes("שם לקוח"));
    const totalCol = cells.findIndex(c => c.includes("סכום כולל"));
    if (nameCol >= 0 && totalCol >= 0) {
      current = { titleRate: pendingTitleRate, invoiceRate: null, invoiceAmount: null, nameCol, totalCol, rows: [] };
      sections.push(current);
      pendingTitleRate = null;
      continue;
    }
    if (!current) continue;

    const rateCol = cells.findIndex(c => BARE_PERCENT.test(c));
    if (rateCol >= 0) {
      current.invoiceRate ??= Number(cells[rateCol].match(BARE_PERCENT)![1]);
      current.invoiceAmount ??= parseCurrency(raw[rateCol + 1]) || null;
      continue;
    }

    // Skip empty/zero rows (incl. the totals row, whose name is empty).
    // Negative rows are kept — credit lines (e.g. old legal entity of a
    // franchisee) must net against the positive rows.
    const name = cells[current.nameCol];
    const total = parseCurrency(raw[current.totalCol]);
    if (name && total !== 0) current.rows.push({ name, total });
  }

  if (pendingTitleRate !== null) broken.push(`כותרת ${pendingTitleRate}% בלי שורת כותרות עמודות`);

  sections.forEach((s, i) => {
    if (s.titleRate !== null && s.invoiceRate !== null && s.titleRate !== s.invoiceRate) {
      broken.push(`קטע ${i + 1}: בכותרת ${s.titleRate}% ובשורת החשבונית ${s.invoiceRate}%`);
    } else if (s.titleRate === null && s.invoiceRate === null) {
      broken.push(`קטע ${i + 1}: לא נמצא אחוז עמלה — אין כותרת "קאסטרה N%" ואין שורת חשבונית ספק`);
    } else if (!CONTRACT_RATES.has((s.titleRate ?? s.invoiceRate)!)) {
      broken.push(`קטע ${i + 1}: ${s.titleRate ?? s.invoiceRate}% אינו אחוז בהסכם עם הספק (17% / 10%)`);
    }
  });

  return { sections, broken };
}

/**
 * Parse מזרח ומערב supplier file with multiple commission rate sections
 * Aggregates same franchisee from different sections and calculates commission
 */
export function parseMizrachUmaaravFile(buffer: Buffer): FileProcessingResult {
  const errors: import("../file-processing-errors").FileProcessingError[] = [];
  const warnings: import("../file-processing-errors").FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    // Read the workbook
    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
    });

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      errors.push(createFileProcessingError("NO_WORKSHEETS"));
      legacyErrors.push("No worksheets found in file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const sheet = workbook.Sheets[sheetName];
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    if (!rawData || rawData.length < 3) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty or too short");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // Detect sections
    const { sections, broken } = detectSections(rawData);

    if (broken.length > 0) {
      const details = broken.join("; ");
      errors.push(createFileProcessingError("PARSE_ERROR", { details }));
      legacyErrors.push(details);
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
    }

    if (sections.length === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not detect any commission sections (17% or 10%) in the file",
        })
      );
      legacyErrors.push("Could not detect any commission sections in the file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
    }

    // Aggregate by franchisee name across sections
    const franchiseeMap = new Map<string, { net: number; commission: number }>();
    const rates: number[] = [];

    for (const section of sections) {
      const rate = (section.titleRate ?? section.invoiceRate)!; // detectSections guarantees one
      rates.push(rate);

      let sectionNet = 0;
      for (const { name, total } of section.rows) {
        const entry = franchiseeMap.get(name) ?? { net: 0, commission: 0 };
        entry.net += total;
        entry.commission += total * rate / 100;
        franchiseeMap.set(name, entry);
        sectionNet += total;
      }

      // The supplier's invoice line is their own commission for this section
      const ours = sectionNet * rate / 100;
      if (section.invoiceAmount !== null && Math.abs(ours - section.invoiceAmount) > 1) {
        const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
        const details =
          `עמלת קטע ${rate}% שחושבה (₪${fmt(ours)}) שונה מהעמלה בשורת החשבונית של הספק ` +
          `(₪${fmt(section.invoiceAmount)}) — ייתכן שזכיין לא נקלט או שהאחוז שגוי`;
        warnings.push(createFileProcessingError("GRAND_TOTAL_MISMATCH", { details }));
        legacyWarnings.push(details);
      }
    }

    // Convert aggregated data to ParsedRowData
    let totalNetAmount = 0;
    let totalGrossAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    // Sort franchisees alphabetically
    const sortedFranchisees = Array.from(franchiseeMap.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], "he")
    );

    for (const [franchiseeName, amounts] of sortedFranchisees) {
      const netAmount = roundAmount(amounts.net);
      const grossAmount = roundAmount(netAmount * (1 + VAT_RATE));
      const preCalculatedCommission = roundAmount(amounts.commission);

      data.push({
        franchisee: franchiseeName,
        date: null,
        grossAmount,
        netAmount,
        originalAmount: netAmount,
        rowNumber: rowNumber++,
        preCalculatedCommission,
      });

      totalNetAmount += netAmount;
      totalGrossAmount += grossAmount;
      processedRows++;
    }

    if (processedRows === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not extract any franchisee data from the file",
        })
      );
      legacyErrors.push("Could not extract any franchisee data from the file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
    }

    // Add info about sections found
    const sectionsSummary = rates.map(r => `${r}%`).join(", ");
    if (sections.length > 0) {
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `זוהו ${sections.length} קטעי עמלות: ${sectionsSummary}`,
        })
      );
      legacyWarnings.push(`זוהו ${sections.length} קטעי עמלות: ${sectionsSummary}`);
    }

    return createResult(
      true,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      rawData.length,
      processedRows,
      rawData.length - processedRows,
      totalGrossAmount,
      totalNetAmount
    );
  } catch (error) {
    errors.push(
      createFileProcessingError("SYSTEM_ERROR", {
        details: error instanceof Error ? error.message : "Unknown error",
      })
    );
    legacyErrors.push(error instanceof Error ? error.message : "Unknown error");
    return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
  }
}

function createResult(
  success: boolean,
  data: ParsedRowData[],
  errors: import("../file-processing-errors").FileProcessingError[],
  warnings: import("../file-processing-errors").FileProcessingError[],
  legacyErrors: string[],
  legacyWarnings: string[],
  totalRows: number,
  processedRows = 0,
  skippedRows = 0,
  totalGrossAmount = 0,
  totalNetAmount = 0
): FileProcessingResult {
  return {
    success,
    data,
    errors,
    warnings,
    legacyErrors,
    legacyWarnings,
    summary: {
      totalRows,
      processedRows,
      skippedRows,
      totalGrossAmount: roundAmount(totalGrossAmount),
      totalNetAmount: roundAmount(totalNetAmount),
      vatAdjusted: false,
    },
  };
}
