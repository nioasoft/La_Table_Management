/**
 * Wolt PDF invoice parser
 *
 * Extracts data from Wolt tax invoices (חשבונית מס מקור).
 * These are invoices issued BY the franchisee TO Wolt.
 * The system needs the total amount and allocation number for journal entries.
 *
 * Key data points:
 * - Franchisee name (issuer)
 * - Invoice number (מס' חשבונית)
 * - Allocation number (מספר הקצאה)
 * - Period
 * - Total sales, additions, deductions
 * - Total including VAT (סה"כ לתשלום)
 * - Wolt's invoice number for offset (חשבונית וולט מספר)
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

    // Extract franchisee name - appears after "בע״מ" or "| ויני"
    let franchiseeName = "";
    // Look for "XXX | YYY" pattern (e.g., "רגבה | ויני")
    const nameMatch = text.match(/([\u0590-\u05FF]+)\s*\|\s*([\u0590-\u05FF]+)/);
    if (nameMatch) {
      franchiseeName = `${nameMatch[2]} ${nameMatch[1]}`; // Reverse RTL order
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

    // Extract total including VAT - the final סה"כ
    let totalAmount = 0;
    // Look for the last large number pattern near "כ"סה"
    const totalMatches = text.match(/([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*\n\s*כ"סה/);
    if (totalMatches) {
      totalAmount = parseFloat(totalMatches[3].replace(/,/g, ""));
    }

    // Alternative: look for the grand total line
    if (totalAmount === 0) {
      const allNumbers = [...text.matchAll(/([\d,]+\.\d{2})/g)].map((m) =>
        parseFloat(m[1].replace(/,/g, ""))
      );
      // The largest number is likely the total including VAT
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
        franchiseeName: franchiseeName || "לא זוהה",
        totalAmount,
        commissionAmount: 0, // Commission is on a separate Wolt invoice
        commissionRate: 0,
        netAmount: totalAmount, // This IS the invoice amount
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
  } catch (error) {
    errors.push(
      `שגיאה בקריאת PDF וולט: ${error instanceof Error ? error.message : String(error)}`
    );
    return { success: false, data: null, errors, warnings };
  }
}
