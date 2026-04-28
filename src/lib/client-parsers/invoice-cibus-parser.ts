/**
 * Cibus/Plaxie invoice PDF parser
 *
 * Parses tax invoices (חשבונית מס מרכזת) from פלאקסי ישראל בע"מ (formerly Sodexo Pass).
 * These are commission invoices that Cibus/Plaxie issues to franchisees.
 *
 * This is SEPARATE from the email-body parser (cibus-parser.ts) which handles
 * the reconciliation report sent in the email body.
 *
 * Key data points:
 * - Invoice number (e.g., SI266016996)
 * - Franchisee name (from "לכבוד:" section or "תאור פרויקט:")
 * - Period dates (from "פרטים:" line)
 * - Line items: עמלת מסעדה, קופת אינפקט, etc.
 * - Pre-VAT total (סה"כ מחיר)
 * - VAT amount (מע"מ)
 * - Grand total including VAT (סה"כ לחשבונית)
 *
 * NOTE: pdf-parse outputs Hebrew text in visual (RTL-reversed) order.
 * Hebrew words appear reversed in the raw text. Numbers remain LTR.
 */

import type { ClientDocumentProcessingResult, ClientParsedLineItem } from "./types";
import { extractAllocationNumber } from "./extract-allocation-number";

// Import from /lib/pdf-parse.js directly — the package's index.js runs a
// debug file-read at module load when `module.parent` is null (breaks Turbopack builds).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

/** Hebrew number pattern: digits with optional commas and decimal */
const NUM_PATTERN = "[\\d,]+\\.?\\d*";

/**
 * Parse a numeric string with commas (e.g., "2,319.49") into a number.
 * Returns 0 if the string is empty or cannot be parsed.
 */
function parseNumber(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/,/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * Convert a 2-digit year to a 4-digit year.
 * Assumes years 00-49 are 2000-2049, 50-99 are 1950-1999.
 */
function expandYear(year: number): number {
  if (year >= 100) return year; // Already 4 digits
  return year < 50 ? 2000 + year : 1900 + year;
}

/**
 * Parse a Cibus/Plaxie tax invoice PDF.
 *
 * For commission invoices:
 * - totalAmount = pre-VAT subtotal (the commission charged, before VAT)
 * - commissionAmount = same as totalAmount
 * - commissionRate = 0 (rate is not derivable from the invoice alone)
 * - netAmount = grand total including VAT
 */
export async function parseCibusInvoice(
  buffer: Buffer,
  mimeType: string
): Promise<ClientDocumentProcessingResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const data = await pdfParse(buffer);
    const text = data.text as string;

    if (!text || text.length < 50) {
      errors.push("לא ניתן לחלץ טקסט מקובץ PDF של חשבונית סיבוס/פלאקסי");
      return { success: false, data: null, errors, warnings };
    }

    // ---------------------------------------------------------------
    // 1. Extract franchisee name
    // ---------------------------------------------------------------
    // Try multiple patterns since pdf-parse may output Hebrew in visual order.
    //
    // Pattern A: "לכבוד:" followed by the franchisee name on the same or next line
    // Pattern B: "תאור פרויקט:" in the footer section
    // Pattern C: Hebrew text near "לכבוד" in visual order
    let franchiseeName = "";

    // Pattern A: "לכבוד:" then the name (may be on same line or next line)
    const lechavodMatch = text.match(
      /לכבוד:?\s*\n?\s*([\u0590-\u05FF][\u0590-\u05FF\s"'"\u05F3\u05F4\-\u2013]+)/
    );
    if (lechavodMatch) {
      franchiseeName = lechavodMatch[1].trim();
    }

    // Pattern B: "תאור פרויקט:" in footer - more reliable if present
    const projectMatch = text.match(
      /תאור\s*פרויקט:?\s*([\u0590-\u05FF][\u0590-\u05FF\s"'"\u05F3\u05F4\-\u2013]*)/
    );
    if (projectMatch) {
      const projectName = projectMatch[1].trim();
      // Prefer project description as it's typically the clean name
      if (projectName) {
        franchiseeName = projectName;
      }
    }

    // Pattern C: Visual order - name appears BEFORE "לכבוד" on the line
    if (!franchiseeName) {
      const visualMatch = text.match(
        /([\u0590-\u05FF][\u0590-\u05FF\s"'"\u05F3\u05F4\-\u2013]+)\s+:?לכבוד/
      );
      if (visualMatch) {
        franchiseeName = visualMatch[1].trim();
      }
    }

    // Pattern D: Visual order for project description
    if (!franchiseeName) {
      const visualProjectMatch = text.match(
        /([\u0590-\u05FF][\u0590-\u05FF\s"'"\u05F3\u05F4\-\u2013]+)\s+:?פרויקט\s+תאור/
      );
      if (visualProjectMatch) {
        franchiseeName = visualProjectMatch[1].trim();
      }
    }

    // ---------------------------------------------------------------
    // 2. Extract invoice number
    // ---------------------------------------------------------------
    let invoiceNumber = "";

    // Pattern: "חשבונית מס מרכזת SI266016996"
    const invoiceMatch = text.match(
      /חשבונית\s*מס\s*(?:מרכזת\s*)?(SI\d+|[A-Z]{0,3}\d{6,})/i
    );
    if (invoiceMatch) {
      invoiceNumber = invoiceMatch[1];
    }

    // Visual order: number before reversed Hebrew
    if (!invoiceNumber) {
      const visualInvMatch = text.match(
        /(SI\d+|[A-Z]{0,3}\d{8,})\s+(?:תזכרמ\s+סמ\s+תינובשח|מרכזת|חשבונית)/
      );
      if (visualInvMatch) {
        invoiceNumber = visualInvMatch[1];
      }
    }

    // Fallback: just look for SI + digits anywhere
    if (!invoiceNumber) {
      const siMatch = text.match(/\b(SI\d{6,})\b/i);
      if (siMatch) {
        invoiceNumber = siMatch[1];
      }
    }

    // ---------------------------------------------------------------
    // 3. Extract period (month/year)
    // ---------------------------------------------------------------
    let periodMonth: number | undefined;
    let periodYear: number | undefined;

    // Pattern: "DD/MM/YY-DD/MM/YY" or "DD/MM/YYYY-DD/MM/YYYY"
    // The start date gives us the period month/year
    const periodMatch = text.match(
      /(\d{2})\/(\d{2})\/(\d{2,4})\s*[-\u2013]\s*\d{2}\/\d{2}\/\d{2,4}/
    );
    if (periodMatch) {
      periodMonth = parseInt(periodMatch[2], 10);
      periodYear = expandYear(parseInt(periodMatch[3], 10));
    }

    // Alternative: "תאריך חשבונית: DD/MM/YY"
    if (!periodMonth) {
      const dateMatch = text.match(
        /תאריך\s*(?:חשבונית)?:?\s*(\d{2})\/(\d{2})\/(\d{2,4})/
      );
      if (dateMatch) {
        periodMonth = parseInt(dateMatch[2], 10);
        periodYear = expandYear(parseInt(dateMatch[3], 10));
        warnings.push(
          'תקופה זוהתה מתאריך החשבונית, לא מתאריכי תקופת הפרטים'
        );
      }
    }

    // ---------------------------------------------------------------
    // 4. Extract line items from the table
    // ---------------------------------------------------------------
    // Table columns: מספר פנקס | מק"ט | תאור מוצר | כמות | סה"כ מחיר | מחיר כולל מע"מ
    // Lines typically look like:
    //   10357816  4000  עמלת מסעדה על פי הסכם  1.00  2,234.35  2,636.53
    //   (blank)   4027  קופת אינפקט,ינו 2026   1.00  85.47     100.85
    const lineItems: ClientParsedLineItem[] = [];

    // Match lines with product code + description + amounts
    // Pattern: optional ledger number, product code (3-6 digits),
    // description (Hebrew), qty, pre-VAT amount, incl-VAT amount
    const lineItemPattern = new RegExp(
      `(?:^|\\n)\\s*(?:\\d+\\s+)?(\\d{3,6})\\s+([\\u0590-\\u05FF][^\\n]*?)\\s+(\\d+\\.\\d{1,2})\\s+(${NUM_PATTERN})\\s+(${NUM_PATTERN})`,
      "gm"
    );

    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineItemPattern.exec(text)) !== null) {
      const description = lineMatch[2].trim();
      const preVatAmount = parseNumber(lineMatch[4]);

      lineItems.push({
        date: null,
        description,
        amount: preVatAmount,
        commission: preVatAmount,
      });
    }

    // ---------------------------------------------------------------
    // 5. Extract financial totals
    // ---------------------------------------------------------------
    // Hebrew abbreviations like סה"כ and מע"מ contain literal double-quotes,
    // so we use new RegExp() with template literals to interpolate NUM_PATTERN.
    // The Hebrew strings use unicode escapes to avoid quote-within-quote issues.

    // Pre-VAT subtotal and VAT amount.
    //
    // pdf-parse emits the totals block of a real Cibus invoice as:
    //
    //     12,838.99
    //     2,311.01
    //     סה"כ מחיר
    //     (18.00%) מע"מ
    //      ש"ח15,150.00סה"כ לחשבונית
    //
    // i.e. the *numbers come BEFORE the labels*: the first number is the
    // pre-VAT subtotal, the second is the VAT amount, and the labels follow
    // on subsequent lines. The two numbers are paired with the two labels
    // ("סה"כ מחיר" / "מע"מ"). We capture both at once with a single anchored
    // regex so we don't accidentally pick up unrelated numbers.
    let preVatTotal = 0;
    let vatAmount = 0;

    // Pattern P1 — paired numbers above paired labels (real-PDF layout).
    // Captures pre-VAT (group 1) and VAT (group 2) together.
    const pairedNumbersPattern = new RegExp(
      `(${NUM_PATTERN})\\s*\\n\\s*(${NUM_PATTERN})\\s*\\n\\s*סה"כ\\s*מחיר\\s*\\n\\s*\\([\\d\\.]+%\\)\\s*מע"מ`
    );
    const pairedMatch = text.match(pairedNumbersPattern);
    if (pairedMatch) {
      preVatTotal = parseNumber(pairedMatch[1]);
      vatAmount = parseNumber(pairedMatch[2]);
    }

    // Fallback patterns for older / alternative layouts.
    if (preVatTotal === 0) {
      const preVatPatterns = [
        // Standard order: סה"כ מחיר 2,319.49
        new RegExp(`סה"כ\\s*מחיר\\s+(${NUM_PATTERN})`),
        // Reversed visual (Hebrew text reversed): 2,319.49 ריחמ כ"הס
        new RegExp(`(${NUM_PATTERN})\\s+ריחמ\\s+כ"הס`),
        // Alternative: מחיר כ"סה 2,319.49
        new RegExp(`מחיר\\s+כ"סה\\s+(${NUM_PATTERN})`),
      ];
      for (const pattern of preVatPatterns) {
        if (preVatTotal > 0) break;
        const m = text.match(pattern);
        if (m) preVatTotal = parseNumber(m[1]);
      }
    }

    if (vatAmount === 0) {
      const vatPatterns = [
        // Standard: מע"מ (18.00%) 417.51
        new RegExp(`מע"מ\\s*\\(\\d+[\\.\\d]*%\\)\\s+(${NUM_PATTERN})`),
        // Reversed: 417.51 (%18.00) מע"מ
        new RegExp(`(${NUM_PATTERN})\\s+\\(\\d+[\\.\\d]*%\\)\\s+מע"מ`),
        // Simple: מע"מ 417.51
        new RegExp(`מע"מ\\s+(${NUM_PATTERN})`),
      ];
      for (const pattern of vatPatterns) {
        if (vatAmount > 0) break;
        const m = text.match(pattern);
        if (m) vatAmount = parseNumber(m[1]);
      }
    }

    // Grand total — Cibus PDF emits this as:
    //     ש"ח15,150.00סה"כ לחשבונית
    // (currency, then number, then label — all run together with no spaces).
    let grandTotal = 0;
    const grandTotalPatterns = [
      // Real-PDF layout: ש"ח15,150.00סה"כ לחשבונית (number flanked by label
      // on the right and currency on the left, all glued together)
      new RegExp(`(?:ש"ח|₪)\\s*(${NUM_PATTERN})\\s*סה"כ\\s*לחשבונית`),
      // Standard order: סה"כ לחשבונית 2,737.00 ש"ח
      new RegExp(`סה"כ\\s*לחשבונית\\s+(${NUM_PATTERN})\\s*(?:ש"ח|₪)?`),
      // Reversed visual: ח"ש 2,737.00 תינובשחל כ"הס
      new RegExp(`(?:ח"ש|₪)\\s*(${NUM_PATTERN})\\s+תינובשחל\\s+כ"הס`),
      // Alternative: לחשבונית כ"סה 2,737.00
      new RegExp(`לחשבונית\\s+כ"סה\\s+(${NUM_PATTERN})\\s*(?:ש"ח|₪)?`),
      // Number before ש"ח near end
      new RegExp(`(${NUM_PATTERN})\\s+ש"ח\\s*$`, "m"),
    ];
    for (const pattern of grandTotalPatterns) {
      if (grandTotal > 0) break;
      const m = text.match(pattern);
      if (m) grandTotal = parseNumber(m[1]);
    }

    // ---------------------------------------------------------------
    // 6. Cross-validate and derive missing values
    // ---------------------------------------------------------------

    // If we have line items but no pre-VAT total, sum them up
    if (preVatTotal === 0 && lineItems.length > 0) {
      preVatTotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
      preVatTotal = Math.round(preVatTotal * 100) / 100;
      warnings.push('סכום לפני מע"מ חושב מסיכום שורות הפריטים');
    }

    // If we have pre-VAT and VAT but no grand total, calculate it
    if (grandTotal === 0 && preVatTotal > 0 && vatAmount > 0) {
      grandTotal = Math.round((preVatTotal + vatAmount) * 100) / 100;
      warnings.push('סה"כ לחשבונית חושב מסכום לפני מע"מ + מע"מ');
    }

    // If we have grand total and pre-VAT but no VAT, calculate it
    if (vatAmount === 0 && grandTotal > 0 && preVatTotal > 0) {
      vatAmount = Math.round((grandTotal - preVatTotal) * 100) / 100;
    }

    // If we have grand total but no pre-VAT, derive it (assume standard VAT)
    if (preVatTotal === 0 && grandTotal > 0) {
      let vatRate = 18; // Default Israel VAT
      const vatRateMatch = text.match(/מע"מ\s*\((\d+[\.\d]*)%\)/);
      if (vatRateMatch) {
        vatRate = parseFloat(vatRateMatch[1]);
      }
      preVatTotal =
        Math.round((grandTotal / (1 + vatRate / 100)) * 100) / 100;
      vatAmount = Math.round((grandTotal - preVatTotal) * 100) / 100;
      warnings.push(
        `סכום לפני מע"מ חושב מהסה"כ לחשבונית (מע"מ ${vatRate}%)`
      );
    }

    // Cross-validate: if we have all three, check consistency
    if (preVatTotal > 0 && vatAmount > 0 && grandTotal > 0) {
      const expectedGrand =
        Math.round((preVatTotal + vatAmount) * 100) / 100;
      const diff = Math.abs(expectedGrand - grandTotal);
      if (diff > 1) {
        warnings.push(
          `פער בין סכומים: לפני מע"מ (${preVatTotal.toFixed(2)}) + מע"מ (${vatAmount.toFixed(2)}) = ${expectedGrand.toFixed(2)}, אך סה"כ לחשבונית = ${grandTotal.toFixed(2)}`
        );
      }
    }

    // ---------------------------------------------------------------
    // 7. Validate we extracted meaningful data
    // ---------------------------------------------------------------
    if (preVatTotal === 0 && grandTotal === 0) {
      errors.push("לא נמצאו סכומים בחשבונית סיבוס/פלאקסי");
      return { success: false, data: null, errors, warnings };
    }

    if (!franchiseeName) {
      warnings.push("לא זוהה שם הזכיין מהחשבונית");
    }

    if (!periodMonth || !periodYear) {
      warnings.push("לא זוהתה תקופת החשבונית");
    }

    if (!invoiceNumber) {
      warnings.push("לא זוהה מספר חשבונית");
    }

    // ---------------------------------------------------------------
    // 8. Build result
    // ---------------------------------------------------------------
    // For commission invoices:
    // - totalAmount = pre-VAT commission amount (what they charge us)
    // - commissionAmount = same (the whole invoice IS the commission)
    // - commissionRate = 0 (not derivable from the invoice alone;
    //   rate depends on transaction volume which is on a separate report)
    // - netAmount = grand total including VAT (what we actually pay)

    const invoiceDescription = invoiceNumber
      ? `חשבונית מס מרכזת ${invoiceNumber}`
      : "חשבונית מס מרכזת סיבוס/פלאקסי";

    // If no line items were parsed, create a single summary line item
    if (lineItems.length === 0 && preVatTotal > 0) {
      lineItems.push({
        date: null,
        description: invoiceDescription,
        amount: preVatTotal,
        commission: preVatTotal,
      });
    }

    // Israeli tax allocation number (מספר הקצאה) — only present on invoices
    // over the threshold (₪10,000 today, dropping to ₪5,000). undefined when absent.
    const allocationNumber = extractAllocationNumber(text);

    return {
      success: true,
      data: {
        franchiseeName: franchiseeName || "לא זוהה",
        totalAmount: preVatTotal,
        commissionAmount: preVatTotal,
        commissionRate: 0,
        netAmount: grandTotal || preVatTotal,
        transactionCount: lineItems.length,
        periodMonth,
        periodYear,
        allocationNumber,
        lineItems,
        rawText: text,
      },
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(
      `שגיאה בקריאת PDF חשבונית סיבוס/פלאקסי: ${error instanceof Error ? error.message : String(error)}`
    );
    return { success: false, data: null, errors, warnings };
  }
}
