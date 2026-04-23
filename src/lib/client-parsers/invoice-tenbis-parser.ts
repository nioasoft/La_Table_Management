/**
 * Tenbis (תן-ביס) commission invoice PDF parser
 *
 * Extracts data from Tenbis tax invoices (חשבונית מס).
 * These are commission invoices issued BY 10bis TO the franchisee.
 *
 * Key data points extracted:
 * - Franchisee name (from "לכבוד:" section)
 * - Invoice number (חשבונית מס מספר)
 * - Invoice date (תאריך)
 * - Period month/year (from line item description "דוח [month]" or invoice date)
 * - Pre-VAT total (commission amount being charged)
 * - VAT amount and rate
 * - Grand total including VAT
 *
 * Note: pdf-parse outputs Hebrew in visual RTL order.
 * "חשבונית מס מספר 500102320" may appear as "500102320 מספר מס חשבונית"
 * Numbers remain LTR within the RTL text flow.
 */

import type { ClientDocumentProcessingResult } from "./types";

// Import from /lib/pdf-parse.js directly — the package's index.js runs a
// debug file-read at module load when `module.parent` is null (breaks Turbopack builds).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

/** Hebrew month names mapped to month numbers (1-12) */
const HEBREW_MONTHS: Record<string, number> = {
  ינואר: 1,
  פברואר: 2,
  מרץ: 3,
  מרס: 3,
  אפריל: 4,
  מאי: 5,
  יוני: 6,
  יולי: 7,
  אוגוסט: 8,
  ספטמבר: 9,
  אוקטובר: 10,
  נובמבר: 11,
  דצמבר: 12,
};

/**
 * Parse a number string that may contain commas and optional currency symbol
 * Returns 0 if parsing fails
 */
function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[₪,\s]/g, "");
  const value = parseFloat(cleaned);
  return isNaN(value) ? 0 : value;
}

/**
 * Try to extract a Hebrew month name from text and return its number (1-12)
 */
function extractHebrewMonth(text: string): number | undefined {
  for (const [name, num] of Object.entries(HEBREW_MONTHS)) {
    if (text.includes(name)) {
      return num;
    }
  }
  return undefined;
}

/**
 * Parse a Tenbis commission invoice PDF (חשבונית מס)
 *
 * Unlike the report parser (tenbis-parser.ts), this handles invoices
 * where Tenbis charges commission fees to franchisees.
 */
export async function parseTenbisInvoice(
  buffer: Buffer,
  mimeType: string
): Promise<ClientDocumentProcessingResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const data = await pdfParse(buffer);
    const text = data.text as string;

    if (!text || text.length < 50) {
      errors.push("לא ניתן לחלץ טקסט מקובץ ה-PDF של חשבונית תן-ביס");
      return { success: false, data: null, errors, warnings };
    }

    const lines = text
      .split("\n")
      .map((l: string) => l.trim())
      .filter(Boolean);

    // ---------------------------------------------------------------
    // 1. Extract franchisee name from "לכבוד:" section
    // ---------------------------------------------------------------
    // In visual RTL, "לכבוד:" might appear as ":לכבוד" or just "לכבוד"
    // The franchisee name typically follows on the same or next line
    let franchiseeName = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Pattern: line contains "לכבוד" (with or without colon on either side)
      if (line.includes("לכבוד")) {
        // Try to extract name from the same line after/before "לכבוד"
        // RTL visual: "שם הזכיין :לכבוד" or "לכבוד: שם הזכיין"
        const sameLineMatch = line.match(
          /לכבוד[:\s]*\s*([\u0590-\u05FF][\u0590-\u05FF\s"'.]+)/
        );
        const sameLineMatchRtl = line.match(
          /([\u0590-\u05FF][\u0590-\u05FF\s"'.]+)\s*:?\s*לכבוד/
        );

        if (sameLineMatch) {
          franchiseeName = sameLineMatch[1].trim();
        } else if (sameLineMatchRtl) {
          franchiseeName = sameLineMatchRtl[1].trim();
        } else if (i + 1 < lines.length) {
          // Name might be on the next line
          const nextLine = lines[i + 1];
          // Accept a line that starts with Hebrew characters as the name
          const nextLineMatch = nextLine.match(
            /^([\u0590-\u05FF][\u0590-\u05FF\s"'.]+)/
          );
          if (nextLineMatch) {
            franchiseeName = nextLineMatch[1].trim();
          }
        }
        break;
      }
    }

    // ---------------------------------------------------------------
    // 2. Extract invoice number
    // ---------------------------------------------------------------
    // "חשבונית מס מספר 500102320" in visual RTL could be:
    //   "500102320 מספר מס חשבונית" or "500102320מספר מס חשבונית"
    let invoiceNumber = "";
    // Pattern A: number near "חשבונית" and "מספר"
    const invoiceNumMatch =
      text.match(/(\d{5,12})\s*מספר\s*מס\s*חשבונית/) ||
      text.match(/חשבונית\s*מס\s*מספר\s*(\d{5,12})/) ||
      text.match(/(\d{5,12})\s*'מס\s*מספר\s*חשבונית/) ||
      text.match(/חשבונית\s*מספר\s*(\d{5,12})/);
    if (invoiceNumMatch) {
      invoiceNumber = invoiceNumMatch[1];
    }

    // ---------------------------------------------------------------
    // 3. Extract invoice date
    // ---------------------------------------------------------------
    // "תאריך: 15/02/2026" in visual RTL: "15/02/2026 :תאריך"
    let invoiceDate: { day: number; month: number; year: number } | null = null;
    const dateMatch =
      text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*:?\s*תאריך/) ||
      text.match(/תאריך\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      invoiceDate = {
        day: parseInt(dateMatch[1]),
        month: parseInt(dateMatch[2]),
        year: parseInt(dateMatch[3]),
      };
    }

    // ---------------------------------------------------------------
    // 4. Extract period from line item description ("דוח ינואר")
    // ---------------------------------------------------------------
    // The line items table has descriptions like "דוח ינואר" (January report)
    // In visual RTL: "ינואר דוח" or "ינואר 'דוח"
    let periodMonth: number | undefined;
    let periodYear: number | undefined;

    // Look for Hebrew month name near "דוח" (report)
    const reportMonthMatch =
      text.match(
        /(ינואר|פברואר|מרץ|מרס|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)\s+דוח/
      ) ||
      text.match(
        /דוח\s+(ינואר|פברואר|מרץ|מרס|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)/
      );
    if (reportMonthMatch) {
      periodMonth = HEBREW_MONTHS[reportMonthMatch[1]];
    }

    // If no month found in description, try to extract from all line text
    if (periodMonth === undefined) {
      periodMonth = extractHebrewMonth(text);
      if (periodMonth !== undefined) {
        warnings.push("חודש הדוח זוהה מטקסט כללי ולא משורת פריט");
      }
    }

    // Fall back to invoice date month if no period month found
    if (periodMonth === undefined && invoiceDate) {
      // The invoice date is typically one month AFTER the report month
      // e.g., invoice dated 15/02/2026 is for January 2026
      // But we can't be sure, so use the invoice month with a warning
      periodMonth = invoiceDate.month;
      warnings.push(
        "חודש הדוח לא זוהה מתיאור הפריט - נלקח מתאריך החשבונית (ייתכן שהחודש הנכון הוא חודש קודם)"
      );
    }

    // Year: prefer extracting from a "דוח [month] [year]" pattern
    // Otherwise use invoice date year
    const yearMatch = text.match(/(\d{4})\s+(ינואר|פברואר|מרץ|מרס|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)\s+דוח/) ||
      text.match(/דוח\s+(ינואר|פברואר|מרץ|מרס|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)\s+(\d{4})/);
    if (yearMatch) {
      // First pattern has year at index 1, second at index 2
      const yearStr = yearMatch[1].match(/\d{4}/) ? yearMatch[1] : yearMatch[2];
      if (yearStr) {
        periodYear = parseInt(yearStr);
      }
    }
    if (periodYear === undefined && invoiceDate) {
      periodYear = invoiceDate.year;
    }

    // ---------------------------------------------------------------
    // 5. Extract pre-VAT subtotal (סה"כ חייב מע"מ)
    // ---------------------------------------------------------------
    // "סה"כ חייב מע"מ ₪1,669.49" in visual RTL:
    //   "₪1,669.49 מע"מ חייב כ"סה" or "1,669.49₪ מע"מ חייב כ"סה"
    let preVatTotal = 0;

    // Pattern: number near "מע"מ חייב כ"סה" (RTL visual of "סה"כ חייב מע"מ")
    const preVatMatch =
      text.match(/₪?([\d,]+\.?\d*)\s*₪?\s*מע"מ\s+חייב\s+כ"סה/) ||
      text.match(/כ"סה\s+חייב\s+מע"מ\s*₪?\s*([\d,]+\.?\d*)/) ||
      text.match(/₪?([\d,]+\.?\d*)\s*₪?\s*מ\.ע\.מ\.?\s+חייב\s+כ"סה/) ||
      text.match(/כ"סה\s+חייב\s+מ\.ע\.מ\.?\s*₪?\s*([\d,]+\.?\d*)/);
    if (preVatMatch) {
      preVatTotal = parseAmount(preVatMatch[1]);
    }

    // ---------------------------------------------------------------
    // 6. Extract VAT amount
    // ---------------------------------------------------------------
    // "מע"מ 18% ₪300.51" in visual RTL: "₪300.51 %18 מע"מ"
    let vatAmount = 0;
    let vatRate = 0;

    const vatMatch =
      text.match(/₪?([\d,]+\.?\d*)\s*₪?\s*%?\s*(\d{1,2})%?\s*מע"מ/) ||
      text.match(/מע"מ\s*(\d{1,2})%?\s*₪?\s*([\d,]+\.?\d*)/) ||
      text.match(/₪?([\d,]+\.?\d*)\s*₪?\s*%?\s*(\d{1,2})%?\s*מ\.ע\.מ/) ||
      text.match(/מ\.ע\.מ\.?\s*(\d{1,2})%?\s*₪?\s*([\d,]+\.?\d*)/);
    if (vatMatch) {
      // Determine which capture group is the amount vs rate
      const g1 = vatMatch[1];
      const g2 = vatMatch[2];
      if (g1 && g2) {
        const v1 = parseAmount(g1);
        const v2 = parseAmount(g2);
        // The smaller number is the rate (e.g., 18), the larger is the amount
        if (v1 > v2) {
          vatAmount = v1;
          vatRate = v2;
        } else {
          vatAmount = v2;
          vatRate = v1;
        }
      }
    }

    // ---------------------------------------------------------------
    // 7. Extract grand total (סה"כ לתשלום)
    // ---------------------------------------------------------------
    // "סה"כ לתשלום ₪1,970.00" in visual RTL: "₪1,970.00 לתשלום כ"סה"
    let grandTotal = 0;

    const grandTotalMatch =
      text.match(/₪?([\d,]+\.?\d*)\s*₪?\s*לתשלום\s+כ"סה/) ||
      text.match(/כ"סה\s+לתשלום\s*₪?\s*([\d,]+\.?\d*)/) ||
      text.match(/:?\s*לתשלום\s+כ"סה\s*₪?\s*([\d,]+\.?\d*)/) ||
      text.match(/₪?([\d,]+\.?\d*)\s*₪?\s*:?\s*לתשלום\s*כ"סה/);
    if (grandTotalMatch) {
      grandTotal = parseAmount(grandTotalMatch[1]);
    }

    // ---------------------------------------------------------------
    // 8. Extract line items (code, description, qty, price, total)
    // ---------------------------------------------------------------
    // Table row example: "source | ₪1,669.49 | ₪1,669.49 | 1.00 | דוח ינואר | 46 | 1"
    // In pdf-parse output, columns may merge or separate differently
    const lineItems: Array<{
      date: null;
      description: string;
      amount: number;
      commission: number;
    }> = [];

    for (const line of lines) {
      // Look for lines with a numeric code, a Hebrew description with "דוח", and amounts
      const itemMatch =
        line.match(
          /([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d.]+)\s+([\u0590-\u05FF][\u0590-\u05FF\s"']*)\s+(\d+)/
        ) ||
        line.match(
          /(\d+)\s+([\u0590-\u05FF][\u0590-\u05FF\s"']*)\s+([\d.]+)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/
        );
      if (itemMatch) {
        // Try to identify the description (contains Hebrew with "דוח")
        const hebrewParts = line.match(
          /[\u0590-\u05FF][\u0590-\u05FF\s"']*/g
        );
        const description = hebrewParts ? hebrewParts.join(" ").trim() : "";
        // Extract the largest number as the amount
        const numbers = [...line.matchAll(/([\d,]+\.\d{2})/g)].map((m) =>
          parseAmount(m[1])
        );
        const amount = numbers.length > 0 ? Math.max(...numbers) : 0;

        if (description && amount > 0) {
          lineItems.push({
            date: null,
            description,
            amount,
            commission: amount, // Each line item IS a commission charge
          });
        }
      }
    }

    // ---------------------------------------------------------------
    // 9. Fallback: if structured extraction failed, try simpler patterns
    // ---------------------------------------------------------------

    // If pre-VAT total not found, try to derive from grand total and VAT
    if (preVatTotal === 0 && grandTotal > 0 && vatAmount > 0) {
      preVatTotal = grandTotal - vatAmount;
      warnings.push("סכום לפני מע\"מ חושב מסה\"כ לתשלום בניכוי מע\"מ");
    }

    // If grand total not found, try to derive from pre-VAT and VAT
    if (grandTotal === 0 && preVatTotal > 0 && vatAmount > 0) {
      grandTotal = preVatTotal + vatAmount;
      warnings.push("סה\"כ לתשלום חושב מסכום לפני מע\"מ + מע\"מ");
    }

    // If still no pre-VAT total, try to find the largest number as grand total
    // and back-calculate using standard VAT rate
    if (preVatTotal === 0 && grandTotal === 0) {
      const allAmounts = [...text.matchAll(/([\d,]+\.\d{2})/g)]
        .map((m) => parseAmount(m[1]))
        .filter((v) => v > 0)
        .sort((a, b) => b - a);

      if (allAmounts.length >= 2) {
        // Assume largest is grand total, second largest is pre-VAT
        grandTotal = allAmounts[0];
        preVatTotal = allAmounts[1];
        // Verify the relationship makes sense (VAT should be ~17-18%)
        const impliedVat = grandTotal - preVatTotal;
        const impliedRate = (impliedVat / preVatTotal) * 100;
        if (impliedRate >= 15 && impliedRate <= 20) {
          vatAmount = impliedVat;
          vatRate = Math.round(impliedRate);
          warnings.push(
            "סכומים זוהו לפי גודל מספרי - ייתכן שאינם מדויקים"
          );
        } else {
          // Reset - the heuristic didn't match expected VAT range
          grandTotal = 0;
          preVatTotal = 0;
        }
      }
    }

    // ---------------------------------------------------------------
    // 10. Validate results
    // ---------------------------------------------------------------
    if (preVatTotal === 0 && grandTotal === 0) {
      errors.push("לא נמצאו סכומים בחשבונית תן-ביס");
      return { success: false, data: null, errors, warnings };
    }

    if (!franchiseeName) {
      warnings.push("לא זוהה שם הזכיין מהחשבונית");
    }

    if (!invoiceNumber) {
      warnings.push("לא זוהה מספר חשבונית");
    }

    if (periodMonth === undefined) {
      warnings.push("לא זוהה חודש הדוח");
    }

    if (periodYear === undefined) {
      warnings.push("לא זוהה שנת הדוח");
    }

    // Cross-validate: pre-VAT + VAT should equal grand total (within ₪1 tolerance)
    if (preVatTotal > 0 && vatAmount > 0 && grandTotal > 0) {
      const expectedGrandTotal = preVatTotal + vatAmount;
      if (Math.abs(expectedGrandTotal - grandTotal) > 1) {
        warnings.push(
          `פער בין סכומים: לפני מע"מ (${preVatTotal.toFixed(2)}) + מע"מ (${vatAmount.toFixed(2)}) = ${expectedGrandTotal.toFixed(2)}, אך סה"כ לתשלום = ${grandTotal.toFixed(2)}`
        );
      }
    }

    // Build description for line item
    const invoiceDesc = [
      invoiceNumber ? `חשבונית מס ${invoiceNumber}` : "חשבונית מס תן-ביס",
      vatRate > 0 ? `מע"מ ${vatRate}%` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    return {
      success: true,
      data: {
        franchiseeName: franchiseeName || "לא זוהה",
        // totalAmount = pre-VAT invoice amount — this IS the commission being charged
        totalAmount: preVatTotal,
        // commissionAmount = same as totalAmount (the invoice IS a commission charge)
        commissionAmount: preVatTotal,
        // commissionRate = 0 (not derivable from the invoice alone)
        commissionRate: 0,
        // netAmount = total with VAT
        netAmount: grandTotal,
        periodMonth,
        periodYear,
        lineItems:
          lineItems.length > 0
            ? lineItems
            : [
                {
                  date: null,
                  description: invoiceDesc,
                  amount: preVatTotal,
                  commission: preVatTotal,
                },
              ],
        rawText: text,
      },
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(
      `שגיאה בקריאת PDF חשבונית תן-ביס: ${error instanceof Error ? error.message : String(error)}`
    );
    return { success: false, data: null, errors, warnings };
  }
}
