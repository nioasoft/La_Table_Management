/**
 * Wolt PDF parser
 *
 * Handles TWO document types:
 *
 * 1. **Sales Report** (sales_report PDF) — the primary document for reconciliation.
 *    Contains a transaction-by-transaction breakdown of all Wolt orders for a branch.
 *    Key data: franchisee name (English or Hebrew in filename), total sales,
 *    additions (refunds), deductions (compensations), extra fees.
 *
 * 2. **Tax Invoice** (חשבונית מס מקור) — legacy format, kept for backwards compat.
 *    Contains invoice-level summary. Franchisee name in "XXX | YYY" Hebrew pattern.
 *
 * The email-inbound handler prefers the sales_report attachment when available.
 */

import type { ClientDocumentProcessingResult } from "./types";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse");

export async function parseWoltFile(
  buffer: Buffer,
  mimeType: string
): Promise<ClientDocumentProcessingResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const data = await pdfParse(buffer);
    const text = data.text as string;

    if (!text || text.length < 50) {
      errors.push("לא ניתן לחלץ טקסט מקובץ ה-PDF של וולט");
      return { success: false, data: null, errors, warnings };
    }

    // Detect document type: sales_report has transaction lines with order numbers
    const isSalesReport =
      text.includes("תואקסע טוריפ") || // "פירוט עסקאות" reversed
      text.includes("פירוט עסקאות") ||
      /Wolt\+הזמנה מספר/.test(text) ||
      /\d{8}\s/.test(text); // 8-digit order numbers

    if (isSalesReport) {
      return parseSalesReport(text, warnings);
    } else {
      return parseTaxInvoice(text, warnings);
    }
  } catch (error) {
    errors.push(
      `שגיאה בקריאת PDF וולט: ${error instanceof Error ? error.message : String(error)}`
    );
    return { success: false, data: null, errors, warnings };
  }
}

/**
 * Parse Wolt sales_report PDF.
 *
 * Structure:
 * - Header: business name (English), tax IDs, address
 * - Transaction table: date, time, order#, delivery/pickup, order ID, price excl VAT, price incl VAT
 * - Daily subtotals ("ליום מוצרים כ"סה") on first line of each day
 * - Grand total: כ"סה {inclVAT} {exclVAT} {inclVAT}
 * - Additions section (תוספות) — refunds, negative amounts
 * - Deductions section (ניכויים) — compensations, positive amounts
 * - Extra fees section (נוספות עמלות)
 */
function parseSalesReport(
  text: string,
  warnings: string[]
): ClientDocumentProcessingResult {
  const errors: string[] = [];

  // ── Extract franchisee name ──
  // Sales reports have the English business name near the top, e.g. "King Kong Hadera Ltd"
  // Also look for Hebrew name patterns
  let franchiseeName = "";

  // Strategy 1: English business name (e.g. "King Kong Hadera Ltd", "Pat Vini Rehovot Ltd")
  const englishNameMatch = text.match(
    /^([A-Z][A-Za-z\s]+(?:Ltd|Inc|Corp|LTD|INC)\.?)\s*$/m
  );
  if (englishNameMatch) {
    franchiseeName = englishNameMatch[1].trim();
  }

  // Strategy 2: Hebrew "XXX | YYY" pattern (some reports may have it)
  if (!franchiseeName) {
    const hebrewNameMatch = text.match(
      /([\u0590-\u05FF]+)\s*\|\s*([\u0590-\u05FF]+)/
    );
    if (hebrewNameMatch) {
      franchiseeName = `${hebrewNameMatch[2]} ${hebrewNameMatch[1]}`;
    }
  }

  // Strategy 3: Look for Hebrew business name near tax ID
  if (!franchiseeName) {
    const hebrewBizMatch = text.match(
      /([\u0590-\u05FF][\u0590-\u05FF\s"']{3,}(?:בע"מ|בעמ|בע״מ))/
    );
    if (hebrewBizMatch) {
      franchiseeName = hebrewBizMatch[1].trim();
    }
  }

  // ── Extract period from transaction dates ──
  let periodMonth: number | undefined;
  let periodYear: number | undefined;

  // Look for date patterns in transaction lines (DD.MM.YYYY)
  const dateMatches = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dateMatches) {
    periodMonth = parseInt(dateMatches[2]);
    periodYear = parseInt(dateMatches[3]);
  }

  // ── Extract total sales ──
  // Grand total line: כ"סה {inclVAT} {exclVAT} {inclVAT}
  let totalAmount = 0;

  // Pattern: numbers followed by כ"סה at the start of a totals section
  // The first כ"סה with a large number is the sales total
  const totalLineMatch = text.match(
    /כ"סה\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/
  );
  if (totalLineMatch) {
    // First number is the total incl VAT
    totalAmount = parseFloat(totalLineMatch[1].replace(/,/g, ""));
  }

  // Alternative: look for reversed pattern (numbers before כ"סה)
  if (totalAmount === 0) {
    const reversedMatch = text.match(
      /([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*כ"סה/
    );
    if (reversedMatch) {
      // The largest of the three numbers is the total incl VAT
      const nums = [
        parseFloat(reversedMatch[1].replace(/,/g, "")),
        parseFloat(reversedMatch[2].replace(/,/g, "")),
        parseFloat(reversedMatch[3].replace(/,/g, "")),
      ];
      totalAmount = Math.max(...nums);
    }
  }

  // ── Extract additions (תוספות) — these are negative (refunds) ──
  let additionsTotal = 0;
  const additionsSection = text.match(
    /תוספות[\s\S]*?כ"סה\s+(-?[\d,]+\.?\d*)/
  );
  if (additionsSection) {
    additionsTotal = parseFloat(
      additionsSection[1].replace(/,/g, "")
    );
  }

  // ── Extract deductions (ניכויים) — these are positive (compensations returned) ──
  let deductionsTotal = 0;
  const deductionsSection = text.match(
    /ניכויים[\s\S]*?כ"סה\s+(-?[\d,]+\.?\d*)/
  );
  if (deductionsSection) {
    deductionsTotal = parseFloat(
      deductionsSection[1].replace(/,/g, "")
    );
  }

  // ── Extract extra fees (נוספות עמלות) ──
  let feesTotal = 0;
  const feesSection = text.match(
    /נוספות עמלות[\s\S]*?כ"סה\s+(-?[\d,]+\.?\d*)/
  );
  if (feesSection) {
    feesTotal = parseFloat(feesSection[1].replace(/,/g, ""));
  }

  // ── Count transactions ──
  // Each transaction line has an 8-digit order number
  const orderNumbers = text.match(/\d{8}/g);
  const transactionCount = orderNumbers ? orderNumbers.length : undefined;

  if (totalAmount === 0) {
    errors.push("לא נמצא סכום כולל בדוח מכירות וולט");
    return { success: false, data: null, errors, warnings };
  }

  // Net = total + additions (negative) + deductions (positive) + fees
  const netAmount = totalAmount + additionsTotal + deductionsTotal + feesTotal;

  if (additionsTotal !== 0 || deductionsTotal !== 0 || feesTotal !== 0) {
    warnings.push(
      `תוספות: ${additionsTotal.toLocaleString()}, ניכויים: ${deductionsTotal.toLocaleString()}, עמלות נוספות: ${feesTotal.toLocaleString()}`
    );
  }

  return {
    success: true,
    data: {
      franchiseeName: franchiseeName || "",
      totalAmount,
      commissionAmount: 0, // Commission is on a separate Wolt invoice
      commissionRate: 0,
      netAmount,
      periodMonth,
      periodYear,
      transactionCount,
      lineItems: [
        {
          date: null,
          description: `דוח מכירות וולט${transactionCount ? ` (${transactionCount} הזמנות)` : ""}`,
          amount: totalAmount,
          commission: 0,
        },
      ],
    },
    errors,
    warnings,
  };
}

/**
 * Parse Wolt tax invoice PDF (legacy format).
 * Kept for backwards compatibility with manually uploaded invoices.
 */
function parseTaxInvoice(
  text: string,
  warnings: string[]
): ClientDocumentProcessingResult {
  const errors: string[] = [];

  // Extract franchisee name - appears in "XXX | YYY" pattern
  let franchiseeName = "";
  const nameMatch = text.match(
    /([\u0590-\u05FF]+)\s*\|\s*([\u0590-\u05FF]+)/
  );
  if (nameMatch) {
    franchiseeName = `${nameMatch[2]} ${nameMatch[1]}`;
  }

  // Extract invoice number
  let invoiceNumber = "";
  const invoiceMatch = text.match(/חשבונית\s*'מס\s*\n?\s*(\d+)/);
  if (invoiceMatch) {
    invoiceNumber = invoiceMatch[1];
  }

  // Extract allocation number (מספר הקצאה)
  let allocationNumber = "";
  const allocMatch = text.match(/הקצאה\s+מספר\s*\n?\s*(\d+)/);
  if (allocMatch) {
    allocationNumber = allocMatch[1];
  }

  // Extract period
  let periodMonth: number | undefined;
  let periodYear: number | undefined;
  const periodMatch = text.match(
    /(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/
  );
  if (periodMatch) {
    periodMonth = parseInt(periodMatch[5]); // Start month
    periodYear = parseInt(periodMatch[6]);
  }

  // Extract total sales (סה"כ מכירות)
  let totalSales = 0;
  const salesMatch = text.match(/מכירות\s+כ"סה\s+([\d,.]+)/);
  if (salesMatch) {
    totalSales = parseFloat(salesMatch[1].replace(/,/g, ""));
  }

  // Extract total including VAT
  let totalAmount = 0;
  const totalMatches = text.match(
    /([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*\n\s*כ"סה/
  );
  if (totalMatches) {
    totalAmount = parseFloat(totalMatches[3].replace(/,/g, ""));
  }

  // Fallback: largest number
  if (totalAmount === 0) {
    const allNumbers = [...text.matchAll(/([\d,]+\.\d{2})/g)].map((m) =>
      parseFloat(m[1].replace(/,/g, ""))
    );
    if (allNumbers.length > 0) {
      totalAmount = Math.max(...allNumbers);
    }
  }

  // Extract Wolt's offset invoice number
  let woltInvoiceNumber = "";
  const woltMatch = text.match(/(\d+)\s+מספר\s+וולט\s+חשבונית/);
  if (woltMatch) {
    woltInvoiceNumber = woltMatch[1];
  }

  if (totalAmount === 0) {
    errors.push("לא נמצא סכום כולל בחשבונית וולט");
    return { success: false, data: null, errors, warnings };
  }

  return {
    success: true,
    data: {
      franchiseeName: franchiseeName || "",
      totalAmount,
      commissionAmount: 0,
      commissionRate: 0,
      netAmount: totalAmount,
      periodMonth,
      periodYear,
      lineItems: [
        {
          date: null,
          description: `חשבונית מס ${invoiceNumber}${allocationNumber ? ` | הקצאה ${allocationNumber}` : ""}${woltInvoiceNumber ? ` | בניכוי חשבונית וולט ${woltInvoiceNumber}` : ""}`,
          amount: totalAmount,
          commission: 0,
        },
      ],
    },
    errors,
    warnings,
  };
}
