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
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#\d+;/g, "");
    }

    // Extract restaurant name
    let franchiseeName = "";
    const nameMatch = text.match(/שם מסעדה:\s*(.+)/);
    if (nameMatch) {
      franchiseeName = nameMatch[1].trim();
    }

    // Extract restaurant number
    let restaurantNumber = "";
    const numMatch = text.match(/מספר מסעדה:\s*(\d+)/);
    if (numMatch) {
      restaurantNumber = numMatch[1];
    }

    // Extract period dates
    let periodMonth: number | undefined;
    let periodYear: number | undefined;
    // Pattern: "עד יום: DD-MM-YYYY" and "תקופת חיוב: מיום: DD-MM-YYYY"
    const periodFromMatch = text.match(/מיום:\s*(\d{2})-(\d{2})-(\d{4})/);
    if (periodFromMatch) {
      periodMonth = parseInt(periodFromMatch[2]);
      periodYear = parseInt(periodFromMatch[3]);
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
    // In Cibus text, the number appears BEFORE the label:
    // "1261.32\nסה"כחיובי מפלאקסי"
    let totalCommission = 0;
    const commMatch = text.match(
      /([\d,.]+)\s*\n\s*סה"כ\s*חיובי\s*מ?פלאקסי/
    );
    if (commMatch) {
      totalCommission = parseFloat(commMatch[1].replace(/,/g, ""));
    }
    // Alternative pattern: number after label
    if (totalCommission === 0) {
      const altMatch = text.match(
        /סה"כ\s*חיובי\s*מ?פלאקסי\s*\n?\s*([\d,.]+)/
      );
      if (altMatch) {
        totalCommission = parseFloat(altMatch[1].replace(/,/g, ""));
      }
    }
    // Last resort: look for "סיכום עמלות ושירותים" followed by a number
    if (totalCommission === 0) {
      const summaryMatch = text.match(
        /סיכום\s+עמלות\s+ושירותים\s*\n\s*\n?\s*([\d,.]+)/
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

    // Calculate total from invoice amount or sum
    const totalAmount = invoiceAmount || 0;
    const netAmount = invoiceAmount > 0 ? invoiceAmount : totalAmount - totalCommission;

    // Calculate commission rate
    const commissionRate =
      totalAmount > 0
        ? Math.round((totalCommission / (totalAmount + totalCommission)) * 10000) / 100
        : 0;

    // Validate
    if (totalAmount === 0 && totalCommission === 0) {
      errors.push("לא נמצאו סכומים בדוח סיבוס");
      return { success: false, data: null, errors, warnings };
    }

    if (!franchiseeName && restaurantNumber) {
      franchiseeName = `מסעדה ${restaurantNumber}`;
    }

    if (!franchiseeName) {
      warnings.push("לא זוהה שם הזכיין מהמסמך");
    }

    return {
      success: true,
      data: {
        franchiseeName: franchiseeName || "לא זוהה",
        totalAmount: totalAmount + totalCommission, // Gross = net (invoice) + commission
        commissionAmount: totalCommission,
        commissionRate,
        netAmount, // This is the amount we invoice Pluxee
        transactionCount: dates.length,
        periodMonth,
        periodYear,
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
