/**
 * Wolt PDF parser
 *
 * Handles THREE document types:
 *
 * 1. **ezcount Sales Tax Invoice** (File B, `לכבוד Wolt Enterprises`) — the preferred
 *    document as of 2026-04. Invoice the restaurant issues to Wolt, ezcount-generated.
 *    Provides both gross sales (Tabit comparison) and net payable (future invoicing).
 *
 * 2. **Sales Report** (sales_report PDF) — legacy primary, kept as fallback.
 *    Transaction-by-transaction breakdown of all Wolt orders for a branch.
 *
 * 3. **Tax Invoice** (חשבונית מס מקור, legacy) — older concise format without the
 *    "Wolt Enterprises" recipient.
 *
 * The email-inbound handler prefers the ezcount sales tax invoice (File B).
 */

import type { ClientDocumentProcessingResult } from "./types";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse");

/**
 * Quick content check: is this buffer the ezcount "restaurant → Wolt" sales
 * invoice (File B), i.e. has `לכבוד Wolt Enterprises` near the recipient block?
 *
 * Used by the email-inbound selector to pick the right attachment when Wolt
 * sends multiple ezcount PDFs (File A = Wolt's commission invoice to the
 * restaurant; File B = restaurant's sales invoice to Wolt) with filenames
 * that differ only by the trailing hash.
 */
export async function isWoltEzcountFileB(buffer: Buffer): Promise<boolean> {
  try {
    const data = await pdfParse(buffer);
    const text = (data.text as string) ?? "";
    return /לכבוד[\s\S]{0,80}?Wolt\s+Enterprises/.test(text);
  } catch {
    return false;
  }
}

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

    // Detect File B (ezcount sales tax invoice to Wolt Enterprises)
    const isEzcountWoltInvoice = /לכבוד[\s\S]{0,80}?Wolt\s+Enterprises/.test(
      text
    );

    if (isEzcountWoltInvoice) {
      return parseEzcountWoltInvoice(text, warnings);
    }

    // Detect sales_report: transaction lines with 8-digit order numbers
    const isSalesReport =
      text.includes("תואקסע טוריפ") || // "פירוט עסקאות" reversed
      text.includes("פירוט עסקאות") ||
      /Wolt\+הזמנה מספר/.test(text) ||
      /\d{8}\s/.test(text);

    if (isSalesReport) {
      return parseSalesReport(text, warnings);
    }

    return parseTaxInvoice(text, warnings);
  } catch (error) {
    errors.push(
      `שגיאה בקריאת PDF וולט: ${error instanceof Error ? error.message : String(error)}`
    );
    return { success: false, data: null, errors, warnings };
  }
}

/**
 * Parse the ezcount-generated sales tax invoice the restaurant issues to Wolt.
 *
 * Structure (RTL, partially reversed by pdf-parse):
 *   Issuer (restaurant) at the top (e.g. "פט ויני עזריאלי בע״מ")
 *   Branch line: "<city> | <ENG_NAME> | <hebName>"
 *   לכבוד / Wolt Enterprises Israel Ltd
 *   תקופת החיוב DD.MM.YYYY - DD.MM.YYYY
 *   מכירות כ"סה <exclVAT> <vatPct> <vatAmt> <inclVAT>        ← gross sales
 *   תוספות כ"סה ...
 *   ניכויים כ"סה ...
 *   כ"סה <exclVAT> <vatAmt> <inclVAT>                         ← net after adjustments
 *
 * Franchisee name is intentionally NOT extracted here — downstream
 * `resolveFranchisee` uses `matchFranchiseeFromFilename` on the ezcount filename
 * (e.g. "נתנזון_NATANZON_חיפה_...pdf"), which is more reliable.
 */
function parseEzcountWoltInvoice(
  text: string,
  warnings: string[]
): ClientDocumentProcessingResult {
  const errors: string[] = [];

  // ── Period: pick the LATER date from "DD.MM.YYYY - DD.MM.YYYY" ──
  // pdf-parse emits the range in RTL order (end - start), so we parse both
  // and take the max to be safe.
  let periodMonth: number | undefined;
  let periodYear: number | undefined;
  const periodMatch = text.match(
    /(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/
  );
  if (periodMatch) {
    const d1 = new Date(
      parseInt(periodMatch[3]),
      parseInt(periodMatch[2]) - 1,
      parseInt(periodMatch[1])
    );
    const d2 = new Date(
      parseInt(periodMatch[6]),
      parseInt(periodMatch[5]) - 1,
      parseInt(periodMatch[4])
    );
    const end = d1 > d2 ? d1 : d2;
    periodMonth = end.getMonth() + 1;
    periodYear = end.getFullYear();
  }

  // ── Gross sales: line containing "מכירות כ"סה" — take the LAST decimal number ──
  let gross = 0;
  const lines = text.split(/\n/);
  for (const line of lines) {
    if (/מכירות\s+כ"סה/.test(line)) {
      const nums = [...line.matchAll(/(-?[\d,]+\.\d{2})/g)].map((m) =>
        parseFloat(m[1].replace(/,/g, ""))
      );
      if (nums.length > 0) {
        gross = nums[nums.length - 1];
        break;
      }
    }
  }

  // ── Net: standalone "כ"סה" line (not the "מכירות/תוספות/ניכויים" rows) ──
  // There can be multiple matches (totals block); take the LAST one in the document.
  let net = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!/^כ"סה\s/.test(trimmed)) continue;
    if (/מכירות|תוספות|ניכויים|בחיוב/.test(trimmed)) continue;
    const nums = [...trimmed.matchAll(/(-?[\d,]+\.\d{2})/g)].map((m) =>
      parseFloat(m[1].replace(/,/g, ""))
    );
    if (nums.length > 0) {
      net = nums[nums.length - 1];
    }
  }

  // ── Invoice number (optional, for description) ──
  let invoiceNumber = "";
  const invoiceMatch = text.match(/חשבונית\s*'מס\s*\n?\s*(\d+)/);
  if (invoiceMatch) {
    invoiceNumber = invoiceMatch[1];
  }

  if (gross === 0) {
    errors.push("לא נמצא סכום מכירות (סה\"כ מכירות) בחשבונית וולט");
    return { success: false, data: null, errors, warnings };
  }

  if (net === 0) {
    // Rare — degrade gracefully
    warnings.push('לא נמצא סכום נטו (סה"כ) — נשמר הסכום ברוטו בלבד');
    net = gross;
  }

  if (Math.abs(gross - net) > 0.01) {
    warnings.push(
      `סה"כ מכירות: ${gross.toLocaleString()} ₪ | סה"כ נטו לתשלום: ${net.toLocaleString()} ₪`
    );
  }

  return {
    success: true,
    data: {
      franchiseeName: "", // resolved downstream from filename
      totalAmount: gross,
      commissionAmount: 0,
      commissionRate: 0,
      netAmount: net,
      periodMonth,
      periodYear,
      lineItems: [
        {
          date: null,
          description: `חשבונית וולט${invoiceNumber ? ` ${invoiceNumber}` : ""}`,
          amount: gross,
          commission: 0,
        },
      ],
    },
    errors,
    warnings,
  };
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
