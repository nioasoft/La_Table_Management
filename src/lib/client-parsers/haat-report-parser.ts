/**
 * HAAT monthly report PDF parser
 *
 * The HAAT "monthly report" (subject: "HAAT Delivery | הדוח החודשי שלך עבור
 * MM/YYYY מוכן") is delivered as a direct Azure Blob link, NOT via ezcount.
 * It's a HAAT-internal layout — distinct from the ezcount-issued HAAT
 * commission invoice handled by `invoice-haat-parser.ts`.
 *
 * Sample header lines (RTL, partially reversed by pdf-parse):
 *   "דווח האאט04/2026"
 *   "Natanzon Burgerפט ויני עזריאלי בע\"מ"
 *   "8095 מספר העסק:516161361 מספר מס עסק:"
 *   "מכירות (₪)3892"
 *   "הוצאות -987.66"
 *   "סכום שיועבר לחשבון הבנק2160.34"
 *
 * Numbers in this layout often appear glued to their label (no separating
 * whitespace), so anchors are followed by `[\s]*` not just whitespace.
 */

import type { ClientDocumentProcessingResult } from "./types";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

const HEBREW_MONTHS_REPORT_HEADER = /דווח\s*האאט\s*(\d{2})\/(\d{4})/;

/**
 * Strip thousand separators and parse a Hebrew/English signed decimal.
 */
function toNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const n = parseFloat(raw.replace(/,/g, "").replace(/\s+/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export async function parseHaatReportFile(
  buffer: Buffer,
  _mimeType: string
): Promise<ClientDocumentProcessingResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const data = await pdfParse(buffer);
    const text = (data.text as string) ?? "";

    if (!text || text.length < 50) {
      errors.push("לא ניתן לחלץ טקסט מקובץ ה-PDF של HAAT");
      return { success: false, data: null, errors, warnings };
    }

    // ── Verify this is actually a HAAT monthly report ──
    if (!/דווח\s*האאט/.test(text)) {
      errors.push("הקובץ אינו דוח חודשי של HAAT");
      return { success: false, data: null, errors, warnings };
    }

    // ── Period from header ──
    let periodMonth: number | undefined;
    let periodYear: number | undefined;
    const periodMatch = text.match(HEBREW_MONTHS_REPORT_HEADER);
    if (periodMatch) {
      periodMonth = parseInt(periodMatch[1], 10);
      periodYear = parseInt(periodMatch[2], 10);
    }

    // ── Franchisee name ──
    // The line right after the "דווח האאט MM/YYYY" header carries the
    // business name. Two layouts have been seen:
    //   "Natanzon Burgerפט ויני עזריאלי בע\"מ" — English brand glued onto
    //       a Hebrew "<...> בע\"מ" company. Prefer the Hebrew side.
    //   "minna tomei" — English-only, no "בע\"מ".
    //
    // Strategy: try Hebrew "<...> בע\"מ" first, then fall back to anything
    // on the line directly following the header.
    let franchiseeName = "";
    const hebrewBizMatch = text.match(
      /([֐-׿][֐-׿\s"']{3,}?(?:בע"מ|בעמ|בע״מ))/
    );
    if (hebrewBizMatch) {
      franchiseeName = hebrewBizMatch[1].trim();
    } else {
      const headerLineMatch = text.match(
        /דווח\s*האאט\s*\d{2}\/\d{4}\s*\r?\n([^\r\n]+)/
      );
      if (headerLineMatch) {
        franchiseeName = headerLineMatch[1].trim();
      }
    }

    // ── Sales total ──
    // pdf-parse sometimes flips the parens for RTL text, so the on-disk
    // bytes read "מכירות )₪(3892" rather than "מכירות (₪)3892". Allow
    // either order, plus the parens-less case for safety.
    let totalAmount = 0;
    const salesMatch = text.match(
      /מכירות\s*[()]*\s*₪?\s*[()]*\s*(-?[\d,]+(?:\.\d+)?)/
    );
    if (salesMatch) {
      totalAmount = toNumber(salesMatch[1]);
    }

    // ── Net (סכום שיועבר לחשבון הבנק) ──
    // What HAAT will actually transfer to the franchisee's bank account.
    let netAmount = 0;
    const netMatch = text.match(
      /סכום\s*שיועבר\s*לחשבון\s*הבנק\s*(-?[\d,]+(?:\.\d+)?)/
    );
    if (netMatch) {
      netAmount = toNumber(netMatch[1]);
    }

    // ── Commission (עמלה על הזמנות) ──
    let commissionAmount = 0;
    const commissionMatch = text.match(
      /עמלה\s*על\s*הזמנות\s*(-?[\d,]+(?:\.\d+)?)/
    );
    if (commissionMatch) {
      commissionAmount = toNumber(commissionMatch[1]);
    }

    // ── Order count (informational) ──
    // The order-count line is RTL-reversed by pdf-parse: "40 :תונמזה רפסמ"
    // ( = "מספר הזמנות: 40" reversed)
    let transactionCount: number | undefined;
    const ordersMatch = text.match(/(\d+)\s*:\s*תונמזה\s*רפסמ/);
    if (ordersMatch) {
      transactionCount = parseInt(ordersMatch[1], 10);
    } else {
      const ordersForward = text.match(/מספר\s*הזמנות\s*:?\s*(\d+)/);
      if (ordersForward) {
        transactionCount = parseInt(ordersForward[1], 10);
      }
    }

    if (totalAmount === 0) {
      errors.push("לא נמצא סכום מכירות בדוח HAAT");
      return { success: false, data: null, errors, warnings };
    }

    if (netAmount === 0) {
      warnings.push('לא נמצא "סכום שיועבר לחשבון הבנק" — נשמר ברוטו בלבד');
      netAmount = totalAmount;
    }

    return {
      success: true,
      data: {
        franchiseeName,
        totalAmount,
        commissionAmount,
        commissionRate: 0,
        netAmount,
        periodMonth,
        periodYear,
        transactionCount,
        lineItems: [
          {
            date: null,
            description: `דוח חודשי HAAT${transactionCount ? ` (${transactionCount} הזמנות)` : ""}`,
            amount: totalAmount,
            commission: commissionAmount,
          },
        ],
      },
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(
      `שגיאה בקריאת PDF של HAAT: ${error instanceof Error ? error.message : String(error)}`
    );
    return { success: false, data: null, errors, warnings };
  }
}
