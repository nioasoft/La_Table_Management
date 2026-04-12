/**
 * Haat Delivery (האט דילברי) PDF invoice parser
 *
 * Parses centralized tax invoices (חשבונית מס מרכזת) from Haat Delivery Ltd.
 * These are charges TO the franchisee for delivery platform services.
 *
 * Document structure:
 * - Header: company name (האט דילברי בע"מ), ח.פ. 516136603, customer (לכבוד)
 * - Invoice number: "חשבונית מס מרכזת SI266004256 - מקור (מסמך ממוחשב)"
 * - Date: "תאריך חשבונית: DD/MM/YY"
 * - Period: "פרטים: MM.YYYY חוד"
 * - Line items table: מק"ט | ברקוד | תאור מוצר | כמות | יתרה למשלוח | מחיר ליחידה | %מע"מ | מחיר לי' כולל מע"מ | סה"כ מחיר
 *   Typical items: עמלת האט (commission), מכשיר האט (device), חיוב מסעדה (charge)
 * - Footer: subtotal, optional discount, VAT, grand total
 *
 * Key data points:
 * - Franchisee name from "לכבוד:" line
 * - Invoice number (SI...)
 * - Period from "פרטים:" or invoice date
 * - Pre-VAT total = totalAmount = commissionAmount
 * - Grand total (incl. VAT) = netAmount
 */

import type { ClientDocumentProcessingResult, ClientParsedLineItem } from "./types";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse");

/**
 * Parse a Haat Delivery PDF invoice.
 * Extracts totals, franchisee name, and period from the centralized invoice.
 */
export async function parseHaatFile(
  buffer: Buffer,
  _mimeType: string
): Promise<ClientDocumentProcessingResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const data = await pdfParse(buffer);
    const text = data.text as string;

    if (!text || text.length < 50) {
      errors.push("לא ניתן לחלץ טקסט מקובץ ה-PDF של האט");
      return { success: false, data: null, errors, warnings };
    }

    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    // ---------------------------------------------------------------
    // Franchisee name
    // ---------------------------------------------------------------
    // "לכבוד: פט ויני עזריאלי בע"מ" or reversed visual order
    let franchiseeName = "";
    for (const line of lines) {
      // Normal order: "לכבוד: ..."
      const lekavod = line.match(/לכבוד[:\s]+(.+)/);
      if (lekavod) {
        franchiseeName = lekavod[1]
          .replace(/[,،]/g, "")
          .replace(/ח\.פ\..*$/, "")
          .replace(/ת\.ז\..*$/, "")
          .trim();
        break;
      }
      // Visual reversed: "דובכל" at end of line
      const reversed = line.match(/(.+?)\s*:?\s*דובכל/);
      if (reversed) {
        franchiseeName = reversed[1]
          .replace(/[,،]/g, "")
          .replace(/\.פ\.ח.*$/, "")
          .replace(/\.ז\.ת.*$/, "")
          .trim();
        break;
      }
    }

    // ---------------------------------------------------------------
    // Invoice number
    // ---------------------------------------------------------------
    let invoiceNumber = "";
    // Pattern: "SI266004256" — alphanumeric invoice ID
    const siMatch = text.match(/\b(SI\d{6,})\b/i);
    if (siMatch) {
      invoiceNumber = siMatch[1].toUpperCase();
    }
    // Fallback: "חשבונית מס מרכזת XXXXX"
    if (!invoiceNumber) {
      const invMatch = text.match(/חשבונית\s+מס\s+מרכזת\s+(\S+)/);
      if (invMatch) {
        invoiceNumber = invMatch[1];
      }
    }
    // Reversed: "XXXXX תזכרמ סמ תינובשח"
    if (!invoiceNumber) {
      const invRevMatch = text.match(/(\S+)\s+תזכרמ\s+סמ\s+תינובשח/);
      if (invRevMatch) {
        invoiceNumber = invRevMatch[1];
      }
    }

    // ---------------------------------------------------------------
    // Customer number
    // ---------------------------------------------------------------
    let customerNumber = "";
    const custMatch = text.match(/מס\.?\s*לקוח[:\s]+(\d+)/);
    if (custMatch) {
      customerNumber = custMatch[1];
    }
    // Reversed: "107143 :חוקל .סמ"
    if (!customerNumber) {
      const custRevMatch = text.match(/(\d+)\s*:?\s*חוקל\s*\.?סמ/);
      if (custRevMatch) {
        customerNumber = custRevMatch[1];
      }
    }

    // ---------------------------------------------------------------
    // Period extraction
    // ---------------------------------------------------------------
    let periodMonth: number | undefined;
    let periodYear: number | undefined;

    // Pattern: "פרטים: 02.2026 חוד" (month.year)
    const periodDotMatch = text.match(/(\d{2})\.(\d{4})\s+חוד/);
    if (periodDotMatch) {
      periodMonth = parseInt(periodDotMatch[1]);
      periodYear = parseInt(periodDotMatch[2]);
    }
    // Reversed: "דוח 2026.02 :םיטרפ"
    if (!periodMonth) {
      const periodRevMatch = text.match(/דוח\s+(\d{4})\.(\d{2})/);
      if (periodRevMatch) {
        periodMonth = parseInt(periodRevMatch[2]);
        periodYear = parseInt(periodRevMatch[1]);
      }
    }
    // Alternative: "MM.YYYY" anywhere
    if (!periodMonth) {
      const altPeriod = text.match(/\b(\d{2})\.(\d{4})\b/);
      if (altPeriod) {
        const m = parseInt(altPeriod[1]);
        const y = parseInt(altPeriod[2]);
        if (m >= 1 && m <= 12 && y >= 2020 && y <= 2030) {
          periodMonth = m;
          periodYear = y;
        }
      }
    }

    // Fallback: invoice date "תאריך חשבונית: DD/MM/YY" or "DD/MM/YYYY"
    if (!periodMonth) {
      const dateMatch = text.match(
        /תאריך\s+חשבונית[:\s]+(\d{2})\/(\d{2})\/(\d{2,4})/
      );
      if (dateMatch) {
        periodMonth = parseInt(dateMatch[2]);
        let year = parseInt(dateMatch[3]);
        if (year < 100) year += 2000; // Convert YY to YYYY
        periodYear = year;
      }
    }
    // Reversed: "YY/MM/DD :הנובשח ךיראת"
    if (!periodMonth) {
      const dateRevMatch = text.match(
        /(\d{2})\/(\d{2})\/(\d{2,4})\s*:?\s*הנובשח\s+ךיראת/
      );
      if (dateRevMatch) {
        periodMonth = parseInt(dateRevMatch[2]);
        let year = parseInt(dateRevMatch[3]);
        if (year < 100) year += 2000;
        periodYear = year;
      }
    }

    // ---------------------------------------------------------------
    // Line items extraction
    // ---------------------------------------------------------------
    const lineItems: ClientParsedLineItem[] = [];

    // Haat line items typically have: description, qty 1.00, unit price, total
    // Common items: "עמלת האט", "מכשיר האט", "חיוב מסעדה"
    // We try to extract description + total amount pairs

    // Pattern: "עמלת האט" or "טאה תלמע" (reversed)
    const haatCommissionMatch = text.match(
      /עמלת\s+האט.*?([\d,]+\.?\d*)/
    );
    if (haatCommissionMatch) {
      lineItems.push({
        date: null,
        description: "עמלת האט",
        amount: parseFloat(haatCommissionMatch[1].replace(/,/g, "")),
        commission: parseFloat(haatCommissionMatch[1].replace(/,/g, "")),
      });
    }
    // Reversed: amount near "טאה תלמע"
    if (lineItems.length === 0) {
      const haatRevMatch = text.match(
        /([\d,]+\.?\d*)\s+טאה\s+תלמע/
      );
      if (haatRevMatch) {
        lineItems.push({
          date: null,
          description: "עמלת האט",
          amount: parseFloat(haatRevMatch[1].replace(/,/g, "")),
          commission: parseFloat(haatRevMatch[1].replace(/,/g, "")),
        });
      }
    }

    // Device fee: "מכשיר האט"
    const deviceMatch = text.match(/מכשיר\s+האט.*?([\d,]+\.?\d*)/);
    if (deviceMatch) {
      const amt = parseFloat(deviceMatch[1].replace(/,/g, ""));
      if (amt > 0) {
        lineItems.push({
          date: null,
          description: "מכשיר האט",
          amount: amt,
          commission: 0,
        });
      }
    }

    // Restaurant charge: "חיוב מסעדה"
    const chargeMatch = text.match(/חיוב\s+מסעדה.*?([\d,]+\.?\d*)/);
    if (chargeMatch) {
      const amt = parseFloat(chargeMatch[1].replace(/,/g, ""));
      if (amt > 0) {
        lineItems.push({
          date: null,
          description: "חיוב מסעדה",
          amount: amt,
          commission: 0,
        });
      }
    }

    // ---------------------------------------------------------------
    // Totals extraction
    // ---------------------------------------------------------------
    let preVatTotal = 0;
    let vatAmount = 0;
    let grandTotal = 0;

    // Pre-VAT subtotal: "מחיר כולל: 1,062.53" or "מחיר אחרי הנחה: 1,062.35"
    // Normal order
    const subtotalMatch = text.match(
      /מחיר\s+כולל[:\s]*([\d,]+\.?\d*)/
    );
    if (subtotalMatch) {
      preVatTotal = parseFloat(subtotalMatch[1].replace(/,/g, ""));
    }
    // After discount takes priority
    const afterDiscountMatch = text.match(
      /מחיר\s+אחרי\s+הנחה[:\s]*([\d,]+\.?\d*)/
    );
    if (afterDiscountMatch) {
      preVatTotal = parseFloat(afterDiscountMatch[1].replace(/,/g, ""));
    }

    // Reversed: "1,062.53 :ללוכ ריחמ"
    if (preVatTotal === 0) {
      const subtotalRevMatch = text.match(
        /([\d,]+\.?\d*)\s*:?\s*ללוכ\s+ריחמ/
      );
      if (subtotalRevMatch) {
        preVatTotal = parseFloat(subtotalRevMatch[1].replace(/,/g, ""));
      }
    }

    // VAT: "מע"מ (18.00%): 191.29"
    const vatMatch = text.match(
      /מע"מ\s*\(?[\d.]+%?\)?[:\s]*([\d,]+\.?\d*)/
    );
    if (vatMatch) {
      vatAmount = parseFloat(vatMatch[1].replace(/,/g, ""));
    }
    // Reversed: "191.29 :(%00.81) מ"עמ"
    if (vatAmount === 0) {
      const vatRevMatch = text.match(
        /([\d,]+\.?\d*)\s*:?\s*\(?%?[\d.]+\)?\s*מ"עמ/
      );
      if (vatRevMatch) {
        vatAmount = parseFloat(vatRevMatch[1].replace(/,/g, ""));
      }
    }

    // Grand total: 'סה"כ מחיר: 1,254.00' or 'סה"כ נותר לתשלום: 1,254.00'
    const grandTotalMatch = text.match(
      /סה"כ\s+(?:מחיר|נותר\s+לתשלום)[:\s]*([\d,]+\.?\d*)/
    );
    if (grandTotalMatch) {
      grandTotal = parseFloat(grandTotalMatch[1].replace(/,/g, ""));
    }
    // Alternative: last 'סה"כ' with a number
    if (grandTotal === 0) {
      const allTotals = [
        ...text.matchAll(/סה"כ[^"\n]*?[:\s]*([\d,]+\.?\d*)/g),
      ];
      for (let i = allTotals.length - 1; i >= 0; i--) {
        const val = parseFloat(allTotals[i][1].replace(/,/g, ""));
        if (val > 0 && val !== preVatTotal) {
          grandTotal = val;
          break;
        }
      }
    }
    // Reversed: "1,254.00 :ריחמ כ"הס" or "1,254.00 :םולשתל רתונ כ"הס"
    if (grandTotal === 0) {
      const grandRevMatches = [
        ...text.matchAll(/([\d,]+\.?\d*)\s*:?\s*(?:ריחמ|םולשתל\s+רתונ)\s+כ"הס/g),
      ];
      if (grandRevMatches.length > 0) {
        const lastMatch = grandRevMatches[grandRevMatches.length - 1];
        grandTotal = parseFloat(lastMatch[1].replace(/,/g, ""));
      }
    }

    // If we have pre-VAT and VAT but no grand total, calculate it
    if (grandTotal === 0 && preVatTotal > 0 && vatAmount > 0) {
      grandTotal = preVatTotal + vatAmount;
    }

    // If we have grand total and VAT but no pre-VAT, calculate it
    if (preVatTotal === 0 && grandTotal > 0 && vatAmount > 0) {
      preVatTotal = grandTotal - vatAmount;
    }

    // If we only have grand total, estimate pre-VAT (18% VAT)
    if (preVatTotal === 0 && grandTotal > 0) {
      preVatTotal = Math.round((grandTotal / 1.18) * 100) / 100;
      warnings.push("סכום לפני מע\"מ חושב מהסכום הכולל (18% מע\"מ)");
    }

    // ---------------------------------------------------------------
    // Validation
    // ---------------------------------------------------------------
    if (preVatTotal === 0 && grandTotal === 0) {
      // Last resort: find the largest numbers in the document
      const allNumbers = [...text.matchAll(/([\d,]+\.\d{2})/g)]
        .map((m) => parseFloat(m[1].replace(/,/g, "")))
        .filter((n) => n > 0);

      if (allNumbers.length > 0) {
        allNumbers.sort((a, b) => b - a);
        grandTotal = allNumbers[0];
        if (allNumbers.length > 1) {
          preVatTotal = allNumbers[1];
        }
        warnings.push("הסכומים חולצו מהמספר הגדול ביותר במסמך - יש לאמת");
      } else {
        errors.push("לא נמצאו סכומים בחשבונית האט");
        return { success: false, data: null, errors, warnings };
      }
    }

    if (!franchiseeName) {
      warnings.push("לא זוהה שם הזכיין מהמסמך");
    }

    if (!periodMonth) {
      warnings.push("לא זוהתה תקופת החשבונית");
    }

    return {
      success: true,
      data: {
        franchiseeName: franchiseeName || "לא זוהה",
        totalAmount: preVatTotal,
        commissionAmount: preVatTotal, // The entire invoice IS the commission charge
        commissionRate: 0, // Not percentage-based; flat service charges
        netAmount: grandTotal || preVatTotal, // Total incl. VAT
        periodMonth,
        periodYear,
        invoiceNumber: invoiceNumber || undefined,
        lineItems:
          lineItems.length > 0
            ? lineItems
            : [
                {
                  date: null,
                  description: `חשבונית מס ${invoiceNumber || "האט"}`,
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
      `שגיאה בקריאת PDF האט: ${error instanceof Error ? error.message : String(error)}`
    );
    return { success: false, data: null, errors, warnings };
  }
}
