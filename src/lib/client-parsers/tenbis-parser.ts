/**
 * Tenbis (תן-ביס) PDF parser
 *
 * Extracts data from Tenbis monthly reconciliation PDF reports.
 * The PDF contains daily breakdown tables and a summary section.
 *
 * Key data points extracted:
 * - Franchisee name (from document title)
 * - Period (from date range)
 * - Total transactions (סה"כ עסקאות)
 * - Commission amount (עמלת תן ביס)
 * - Terminal fee (טרמינל)
 * - Total to pay (סה"כ לתשלום)
 */

import type { ClientDocumentProcessingResult } from "./types";
import { extractAllocationNumber } from "./extract-allocation-number";

// Import from /lib/pdf-parse.js directly — the package's index.js runs a
// debug file-read at module load when `module.parent` is null (breaks Turbopack builds).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

/**
 * Parse a Tenbis PDF report
 */
export async function parseTenbisFile(
  buffer: Buffer,
  mimeType: string
): Promise<ClientDocumentProcessingResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const data = await pdfParse(buffer);
    const text = data.text as string;

    if (!text || text.length < 50) {
      errors.push("לא ניתן לחלץ טקסט מקובץ ה-PDF של תן-ביס");
      return { success: false, data: null, errors, warnings };
    }

    // Extract franchisee name from the PDF text
    // pdf-parse outputs RTL Hebrew in visual order. The pattern is:
    //   Line N: "XXX למסעדת עסקאות פירוט" (company)
    //   Line N+k: "YYY למסעדת עסקאות פירוט" (specific branch - this is what we want)
    // We want the LAST occurrence before the table header
    let franchiseeName = "";
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const m = line.match(/^([\u0590-\u05FF"']+(?:\s+[\u0590-\u05FF"']+)*)\s+למסעדת\s+עסקאות\s+פירוט$/);
      if (m) {
        franchiseeName = m[1].trim();
      }
      // Stop when we hit the table header
      if (line.includes("הזמנות") && line.includes("משלוחים")) break;
    }

    // Extract period dates
    let periodMonth: number | undefined;
    let periodYear: number | undefined;
    const dateMatch = text.match(
      /(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/
    );
    if (dateMatch) {
      periodMonth = parseInt(dateMatch[2]); // Start month
      periodYear = parseInt(dateMatch[3]);
    }

    // Extract summary line: סיכום120564781230-3906-17670-1983.93
    const summaryMatch = text.match(
      /סיכום(\d+)(\d+)(\d+)-(\d+)-(\d+)-([\d.]+)/
    );

    // Extract total transactions.
    //
    // Tenbis invoices list TWO totals in the summary block:
    //   1. "סה\"כ עסקאות XXXXX ש\"ח"               ← raw transactions (incl. HH-on-house)
    //   2. "סה\"כ עסקאות לחישוב עמלה XXXXX ש\"ח"  ← the commissionable total
    //      which deducts "עסקאות HappyHour על חשבון המסעדה" from #1
    //
    // pdf-parse reverses the RTL lines, so on disk they look like:
    //   " ח\"ש 18872.6 עסקאות כ\"סה"                           ← raw
    //   " ח\"ש 18857.2 עמלה לחישוב עסקאות כ\"סה"              ← commissionable
    //
    // Prefer the commissionable total (#2) — that's the number accountants
    // reconcile against, and it's what the commission/net-payable math in
    // the rest of the invoice sums back to. The raw total is a false
    // positive because it double-counts HH orders the restaurant gave away.
    let totalAmount = 0;
    const commissionableMatch = text.match(
      /ח"ש\s+([\d,.]+)\s+עמלה\s+לחישוב\s+עסקאות\s+כ"סה/
    );
    if (commissionableMatch) {
      totalAmount = parseFloat(commissionableMatch[1].replace(/,/g, ""));
    } else {
      // Fallback: older invoice layouts without the HH-on-house line just
      // list "סה\"כ עסקאות" once, which is already the commissionable total.
      const totalMatch = text.match(/ח"ש\s+([\d,.]+)\s+עסקאות\s+כ"סה/);
      if (totalMatch) {
        totalAmount = parseFloat(totalMatch[1].replace(/,/g, ""));
      }
    }

    // Extract commission: ח"ש XXXX.XX ביס תן עמלת
    let commissionAmount = 0;
    const commissionMatch = text.match(
      /ח"ש\s+([\d,.]+)\s+ביס\s+תן\s+עמלת/
    );
    if (commissionMatch) {
      commissionAmount = parseFloat(commissionMatch[1].replace(/,/g, ""));
    }

    // Extract terminal fee: ח"ש XXX טרמינל
    let terminalFee = 0;
    const terminalMatch = text.match(/ח"ש\s+([\d,.]+)\s+טרמינל/);
    if (terminalMatch) {
      terminalFee = parseFloat(terminalMatch[1].replace(/,/g, ""));
    }

    // Extract total to pay: ח"שXXXXX.XX:לתשלום כ"סה
    let netAmount = 0;
    const paymentMatch = text.match(/:לתשלום\s+כ"סה\s*([\d,.]+)\s*ח"ש/);
    if (paymentMatch) {
      netAmount = parseFloat(paymentMatch[1].replace(/,/g, ""));
    }
    // Alternative pattern
    if (netAmount === 0) {
      const altMatch = text.match(/לתשלום\s+כ"סה([\d,.]+)ח"ש/);
      if (altMatch) {
        netAmount = parseFloat(altMatch[1].replace(/,/g, ""));
      }
    }

    // Validate we got meaningful data
    if (totalAmount === 0 && commissionAmount === 0 && netAmount === 0) {
      errors.push("לא נמצאו סכומים בדוח תן-ביס");
      return { success: false, data: null, errors, warnings };
    }

    // Calculate net amount if not found directly
    if (netAmount === 0 && totalAmount > 0) {
      netAmount = totalAmount - commissionAmount - terminalFee;
    }

    const totalCommission = commissionAmount + terminalFee;
    const commissionRate =
      totalAmount > 0
        ? Math.round((totalCommission / totalAmount) * 10000) / 100
        : 0;

    if (!franchiseeName) {
      warnings.push("לא זוהה שם הזכיין מהמסמך");
    }

    // Israeli tax allocation number (מספר הקצאה) — surfaced when the report
    // happens to include one (rare for client_report files but harmless).
    const allocationNumber = extractAllocationNumber(text);

    return {
      success: true,
      data: {
        franchiseeName: franchiseeName || "לא זוהה",
        totalAmount,
        commissionAmount: totalCommission,
        commissionRate,
        netAmount,
        periodMonth,
        periodYear,
        allocationNumber,
      },
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(
      `שגיאה בקריאת PDF תן-ביס: ${error instanceof Error ? error.message : String(error)}`
    );
    return { success: false, data: null, errors, warnings };
  }
}
