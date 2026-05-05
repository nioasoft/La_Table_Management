/**
 * Cibus/Pluxee parser
 *
 * Cibus (now Pluxee) sends monthly reconciliation reports in the email body
 * as HTML/plain text. The parser works on the plain text version.
 *
 * Key data points:
 * - Restaurant number (מספר מסעדה)
 * - Restaurant name (שם מסעדה)
 * - Period dates
 * - Total commission (סה"כ חיובי מפלאקסי)
 * - Invoice amount (חשבונית מס לפלאקסי על סכום כולל מע"מ)
 * - Daily breakdown: delivery commission, delivery count, delivery amount,
 *   sitting commission, sitting count, sitting amount, date
 */

import type { ClientDocumentProcessingResult, ClientParsedLineItem } from "./types";
import { extractAllocationNumber } from "./extract-allocation-number";

/**
 * Parse Cibus/Pluxee email body text.
 * Accepts either plain text or HTML (will strip tags from HTML).
 */
export async function parseCibusFile(
  buffer: Buffer,
  mimeType: string
): Promise<ClientDocumentProcessingResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    let text = buffer.toString("utf-8");

    // If HTML, strip tags to get plain text
    if (text.includes("<html") || text.includes("<table")) {
      text = text
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/tr>/gi, "\n")
        .replace(/<\/td>/gi, "\t")
        .replace(/<\/th>/gi, "\t")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#\d+;/g, "");
    }

    // Extract restaurant name
    //
    // Pluxee renders cells with mixed direction attributes; once HTML is
    // stripped the resulting plain text exposes two orderings:
    //   label-first (LTR cell):  "שם מסעדה : VINNI - רגבה"
    //   value-first (RTL cell):  "VINNI - רגבה : שם מסעדה"
    // The colon may have surrounding whitespace ("שם מסעדה :", not
    // "שם מסעדה:"), and the value can be Hebrew, Latin (`VINNI`), or a
    // mix joined by " - ". Both orderings are accepted.
    let franchiseeName = "";
    const nameLabelFirst = text.match(/שם\s*מסעדה\s*:\s*([^\n\r]+)/);
    if (nameLabelFirst?.[1]?.trim()) {
      franchiseeName = nameLabelFirst[1].trim();
    }
    if (!franchiseeName) {
      const nameValueFirst = text.match(/([^\n\r]+?)\s*:\s*שם\s*מסעדה/);
      if (nameValueFirst?.[1]?.trim()) {
        franchiseeName = nameValueFirst[1].trim();
      }
    }

    // Extract restaurant number — same dual-ordering logic.
    //   label-first: "מספר מסעדה: 44890"
    //   value-first: "44890 :מספר מסעדה"  (currently used by Pluxee)
    let restaurantNumber = "";
    const numLabelFirst = text.match(/מספר\s*מסעדה\s*:?\s*(\d+)/);
    if (numLabelFirst?.[1]) {
      restaurantNumber = numLabelFirst[1];
    }
    if (!restaurantNumber) {
      const numValueFirst = text.match(/(\d+)\s*:?\s*מספר\s*מסעדה/);
      if (numValueFirst?.[1]) {
        restaurantNumber = numValueFirst[1];
      }
    }

    // Extract period dates
    let periodMonth: number | undefined;
    let periodYear: number | undefined;
    // Pluxee dates appear in either order:
    //   label-first: "מיום: 05-05-2026"
    //   value-first: "05-05-2026: מיום"  (currently used by Pluxee)
    const periodFromLabelFirst = text.match(
      /מיום\s*:?\s*(\d{2})-(\d{2})-(\d{4})/
    );
    const periodFromValueFirst =
      periodFromLabelFirst ??
      text.match(/(\d{2})-(\d{2})-(\d{4})\s*:?\s*מיום/);
    if (periodFromValueFirst) {
      periodMonth = parseInt(periodFromValueFirst[2]);
      periodYear = parseInt(periodFromValueFirst[3]);
    }

    // Extract invoice amount (total incl. VAT)
    // Pattern: "חשבונית מס לפלאקסי על סכום כולל מע"מ בסך XXXXX.XX ₪"
    let invoiceAmount = 0;
    const invoiceMatch = text.match(
      /סכום כולל מע"מ בסך\s+([\d,.]+)\s*₪/
    );
    if (invoiceMatch) {
      invoiceAmount = parseFloat(invoiceMatch[1].replace(/,/g, ""));
    }

    // Extract total commission
    // Label variants: "סה"כ חיובי מפלאקסי" / "סה"כ חיובים מפלאקסי"
    let totalCommission = 0;
    // Pattern 1: number BEFORE label (number\nסה"כ חיובי/ם מפלאקסי)
    const commMatch = text.match(
      /([\d,.]+)\s*\n\s*סה"כ\s*חיובי[ם]?\s*מ?פלאקסי/
    );
    if (commMatch) {
      totalCommission = parseFloat(commMatch[1].replace(/,/g, ""));
    }
    // Pattern 2: number AFTER label (סה"כ חיובי/ם מפלאקסי\nnumber)
    if (totalCommission === 0) {
      const altMatch = text.match(
        /סה"כ\s*חיובי[ם]?\s*מ?פלאקסי\s*\n?\s*([\d,.]+)/
      );
      if (altMatch) {
        totalCommission = parseFloat(altMatch[1].replace(/,/g, ""));
      }
    }
    // Pattern 3: "סיכום עמלות ושירותים" section header, number follows
    if (totalCommission === 0) {
      const summaryMatch = text.match(
        /סיכום\s+עמלות\s+ושירותים[\s\S]*?([\d,.]+)\s*\n\s*סה"כ\s*חיובי[ם]?\s*מ?פלאקסי/
      );
      if (summaryMatch) {
        totalCommission = parseFloat(summaryMatch[1].replace(/,/g, ""));
      }
    }

    // Extract daily line items
    // Pattern per line: commission\ncount\namount\ncommission\ncount\namount\ndate
    // (delivery_commission, delivery_count, delivery_amount, sit_commission, sit_count, sit_amount, date)
    const lineItems: ClientParsedLineItem[] = [];
    const dateLinePattern =
      /(\d{4}-\d{2}-\d{2})/g;
    const dates = [...text.matchAll(dateLinePattern)];

    // The invoice amount IS the gross sales (total order value).
    // Net = gross - commission (what the restaurant actually receives).
    const grossAmount = invoiceAmount;
    const netAmount = grossAmount > 0 ? grossAmount - totalCommission : 0;

    // Calculate commission rate as % of gross
    const commissionRate =
      grossAmount > 0
        ? Math.round((totalCommission / grossAmount) * 10000) / 100
        : 0;

    // Validate
    //
    // Pluxee sends a daily report regardless of activity, so an "empty"
    // body where every figure is 0 is a legitimate report (the franchisee
    // had no Cibus orders that day). Treat it as a warning, not an error,
    // so franchisee identification still completes and the period record
    // is created. Without this, every quiet day would log a failure in
    // gmail_sync_log even though the email was structurally valid.
    if (grossAmount === 0 && totalCommission === 0) {
      warnings.push("דוח סיבוס ללא תנועה — אפס סכומים");
    } else if (grossAmount === 0 && totalCommission > 0) {
      warnings.push("לא נמצא סכום חשבונית — רק עמלה");
    }

    if (!franchiseeName && restaurantNumber) {
      franchiseeName = `מסעדה ${restaurantNumber}`;
    }

    if (!franchiseeName) {
      warnings.push("לא זוהה שם הזכיין מהמסמך");
    }

    // Israeli tax allocation number (מספר הקצאה) — surfaced when present.
    const allocationNumber = extractAllocationNumber(text);

    return {
      success: true,
      data: {
        franchiseeName: franchiseeName || "",
        totalAmount: grossAmount, // Gross sales = invoice amount
        commissionAmount: totalCommission,
        commissionRate,
        netAmount, // Gross - commission = what restaurant receives
        transactionCount: dates.length,
        periodMonth,
        periodYear,
        allocationNumber,
        lineItems,
      },
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(
      `שגיאה בקריאת דוח סיבוס: ${error instanceof Error ? error.message : String(error)}`
    );
    return { success: false, data: null, errors, warnings };
  }
}
