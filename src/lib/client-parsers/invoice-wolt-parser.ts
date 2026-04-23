/**
 * Wolt commission invoice parser
 *
 * Parses Wolt commission invoices ("חשבונית מס מקור") issued BY Wolt
 * TO the franchisee. These invoices detail the commissions Wolt charges
 * on delivery orders, takeaway orders, and additional fees.
 *
 * This is DIFFERENT from wolt-parser.ts which parses the franchisee's
 * tax invoice issued TO Wolt (the sales/revenue invoice).
 *
 * Invoice structure:
 * 1. Header: franchisee name, invoice number, allocation number, period
 * 2. Section "עמלות בגין מכירות" - Sales commissions table (delivery %, takeaway %)
 * 3. Section "עמלות נוספות" - Additional fees (quality, organization, etc.)
 * 4. Section "תיאור" - Description items (eSIM charges, etc.)
 * 5. Grand total "סכום חשבונית" - pre-VAT, VAT, total with VAT
 *
 * Key data points:
 * - totalAmount = pre-VAT grand total (the commission amount)
 * - commissionAmount = same as totalAmount
 * - netAmount = total with VAT (what the franchisee actually pays)
 * - commissionRate = 0 (multiple rates in invoice, can't pick one)
 *
 * NOTE: pdf-parse outputs Hebrew in visual (reversed) order.
 * All regex patterns are written to match reversed Hebrew text.
 */

import { createRequire } from "node:module";
import type { ClientDocumentProcessingResult, ClientParsedLineItem } from "./types";

const pdfParse = createRequire(import.meta.url)("pdf-parse");

/**
 * Parse a number string from the PDF text.
 * Handles comma-separated thousands (e.g., "13,727.04") and plain decimals.
 */
function parseNumber(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  const value = parseFloat(cleaned);
  return isNaN(value) ? 0 : value;
}

/**
 * Extract all decimal numbers from a text segment.
 * Returns numbers in order of appearance.
 */
function extractNumbers(text: string): number[] {
  const matches = [...text.matchAll(/([\d,]+\.\d{2})/g)];
  return matches.map((m) => parseNumber(m[1]));
}

/**
 * Try to extract the franchisee name from the "לכבוד" section.
 *
 * In visual order, the PDF text around the franchisee section looks like:
 *   "רגבה | ויני / פ"עב רגבה ויני"
 * or similar patterns with the franchisee name.
 *
 * We try multiple patterns to maximize extraction success.
 */
function extractFranchiseeName(text: string): string {
  // Pattern 1: "NAME | BRAND" or "BRAND | NAME" (pipe separator)
  const pipeMatch = text.match(
    /([\u0590-\u05FF\s]+)\s*\|\s*([\u0590-\u05FF\s]+)/
  );
  if (pipeMatch) {
    const part1 = pipeMatch[1].trim();
    const part2 = pipeMatch[2].trim();
    // In visual RTL, the order is reversed; typically "BRAND NAME"
    // Return both parts joined
    return `${part2} ${part1}`.trim();
  }

  // Pattern 2: After "לכבוד" or "דובכל" (reversed)
  const lkMatch = text.match(/(?:לכבוד|דובכל)\s*\n\s*([\u0590-\u05FF\s"]+)/);
  if (lkMatch) {
    return lkMatch[1].trim().replace(/"/g, "").substring(0, 50);
  }

  // Pattern 3: Before company ID pattern (ח.פ / ע.מ / מספר)
  const idMatch = text.match(
    /([\u0590-\u05FF\s]+)\s*(?:פ"עב|מ"עב|פ\.ח|מ\.ע)\s/
  );
  if (idMatch) {
    return idMatch[1].trim().substring(0, 50);
  }

  return "";
}

/**
 * Extract the billing period from "תקופת החיוב DD.MM.YYYY - DD.MM.YYYY".
 * Returns the start month/year of the period.
 *
 * In visual order the text may appear as:
 *   "28.02.2026 - 01.02.2026 בויחה תפוקת"
 * or:
 *   "תקופת החיוב 01.02.2026 - 28.02.2026"
 */
function extractPeriod(
  text: string
): { month: number; year: number } | null {
  // Look for two DD.MM.YYYY dates separated by " - "
  const dateRangeMatch = text.match(
    /(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/
  );

  if (dateRangeMatch) {
    // We have two dates. In the invoice, the period is "start - end".
    // In visual RTL, the order might be "end - start".
    // Parse both and use the earlier date's month/year.
    const date1Month = parseInt(dateRangeMatch[2]);
    const date1Year = parseInt(dateRangeMatch[3]);
    const date2Month = parseInt(dateRangeMatch[5]);
    const date2Year = parseInt(dateRangeMatch[6]);

    // Pick the earlier date as the period start
    if (
      date1Year < date2Year ||
      (date1Year === date2Year && date1Month < date2Month)
    ) {
      return { month: date1Month, year: date1Year };
    }
    if (
      date2Year < date1Year ||
      (date2Year === date1Year && date2Month < date1Month)
    ) {
      return { month: date2Month, year: date2Year };
    }
    // Same month/year - just use first
    return { month: date1Month, year: date1Year };
  }

  return null;
}

/**
 * Extract the invoice number from the PDF text.
 * Pattern: "חשבונית מספר NNNN" or "NNNN חשבונית 'מס"
 */
function extractInvoiceNumber(text: string): string {
  // Visual RTL: number appears before or after "חשבונית"
  const match =
    text.match(/(\d{5,10})\s*(?:חשבונית|הרוטקפ)/) ||
    text.match(/(?:חשבונית|הרוטקפ)\s*(?:'מס|סמ)?\s*\n?\s*(\d{5,10})/);

  return match ? (match[1] || match[2] || "") : "";
}

/**
 * Extract the allocation number (מספר הקצאה).
 */
function extractAllocationNumber(text: string): string {
  const match =
    text.match(/(\d{8,12})\s*(?:הקצאה|הצקה)\s*(?:מספר|רפסמ)/) ||
    text.match(/(?:הקצאה|הצקה)\s*(?:מספר|רפסמ)\s*\n?\s*(\d{8,12})/);

  return match ? (match[1] || match[2] || "") : "";
}

/**
 * Extract the grand total row from the invoice.
 *
 * The grand total appears as "סכום חשבונית" with three values:
 *   - סכום (ללא מע"מ) - pre-VAT total
 *   - מע"מ - VAT amount
 *   - סכום (כולל מע"מ) - total including VAT
 *
 * This is the most critical extraction. We use multiple strategies:
 * 1. Look for "חשבונית סכום" pattern (visual RTL of "סכום חשבונית")
 * 2. Look for the three numbers near the grand total label
 * 3. Fallback: find the largest number group at the end of the document
 */
function extractGrandTotal(
  text: string
): { preVat: number; vat: number; withVat: number } | null {
  // Strategy 1A — most precise: "חשבונית סכום" followed by the explicit
  // "preVat <vat%>% vat withVat" sequence as it appears in modern Wolt
  // invoices (e.g. "חשבונית סכום 196,127.17 18.00% 35,302.92 231,430.09").
  // Skipping the % portion is critical, otherwise the percentage value gets
  // captured as one of the amounts and corrupts the result.
  const explicitPattern =
    /חשבונית\s+סכום[\s\S]{0,30}?([\d,]+\.\d{2})\s*\d+(?:\.\d{1,2})?%\s*([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/;
  const explicitMatch = text.match(explicitPattern);
  if (explicitMatch) {
    const preVat = parseNumber(explicitMatch[1]);
    const vat = parseNumber(explicitMatch[2]);
    const withVat = parseNumber(explicitMatch[3]);
    if (preVat > 0 && vat >= 0 && withVat > 0 && Math.abs(preVat + vat - withVat) < 1) {
      return { preVat, vat, withVat };
    }
  }

  // Strategy 1B — same explicit format but with the label AFTER the numbers
  // (some pdf-parse outputs reverse the order).
  const explicitReversedPattern =
    /([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*\d+(?:\.\d{1,2})?%\s*([\d,]+\.\d{2})[\s\S]{0,30}?חשבונית\s+סכום/;
  const reversedMatch = text.match(explicitReversedPattern);
  if (reversedMatch) {
    // Order in text (RTL-flipped output): withVat, vat, preVat
    const withVat = parseNumber(reversedMatch[1]);
    const vat = parseNumber(reversedMatch[2]);
    const preVat = parseNumber(reversedMatch[3]);
    if (preVat > 0 && vat >= 0 && withVat > 0 && Math.abs(preVat + vat - withVat) < 1) {
      return { preVat, vat, withVat };
    }
  }

  // Strategy 1C (legacy fallback): three plain numbers near the label,
  // without expecting the % marker. Used only when the explicit form fails.
  // Tightened to require the smallest+middle≈largest sum so VAT-percent
  // values (which never sum to anything meaningful) are rejected.
  const invoiceTotalPatterns = [
    /חשבונית\s+סכום\s*\n?\s*([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/,
    /([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*\n?\s*חשבונית\s+סכום/,
    /חשבונית\s+סכום[\s\S]{0,30}?([\d,]+\.\d{2})[\s\S]{0,20}?([\d,]+\.\d{2})[\s\S]{0,20}?([\d,]+\.\d{2})/,
    /([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})[\s\S]{0,30}?חשבונית\s+סכום/,
  ];

  for (const pattern of invoiceTotalPatterns) {
    const match = text.match(pattern);
    if (match) {
      const n1 = parseNumber(match[1]);
      const n2 = parseNumber(match[2]);
      const n3 = parseNumber(match[3]);
      const sorted = [n1, n2, n3].sort((a, b) => a - b);
      const [smallest, middle, largest] = sorted;
      // Only accept if the three values truly form a preVat+vat=withVat triple
      if (Math.abs(middle + smallest - largest) < 1 && middle > smallest) {
        return { preVat: middle, vat: smallest, withVat: largest };
      }
      if (Math.abs(n1 + n2 - n3) < 1 && n1 > 0 && n2 >= 0 && n3 > 0) {
        return { preVat: n1, vat: n2, withVat: n3 };
      }
      // Otherwise reject this match and let later strategies try.
    }
  }

  // Strategy 2: Look for the last occurrence of three numbers on the same line
  // near the end of the document (last 30% of text)
  const lastThird = text.substring(Math.floor(text.length * 0.7));
  const threeNumPattern = /([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/g;
  let lastTriple: RegExpExecArray | null = null;
  let triple: RegExpExecArray | null;
  while ((triple = threeNumPattern.exec(lastThird)) !== null) {
    lastTriple = triple;
  }

  if (lastTriple) {
    const n1 = parseNumber(lastTriple[1]);
    const n2 = parseNumber(lastTriple[2]);
    const n3 = parseNumber(lastTriple[3]);
    const sorted = [n1, n2, n3].sort((a, b) => a - b);
    const [smallest, middle, largest] = sorted;
    if (Math.abs(middle + smallest - largest) < 1) {
      return { preVat: middle, vat: smallest, withVat: largest };
    }
    // Fallback: assume order is preVat, vat, withVat
    if (Math.abs(n1 + n2 - n3) < 1) {
      return { preVat: n1, vat: n2, withVat: n3 };
    }
    return { preVat: middle, vat: smallest, withVat: largest };
  }

  // Strategy 3: Find the two largest numbers in the last portion
  // The largest is likely withVat, second largest is preVat
  const endNumbers = extractNumbers(lastThird);
  if (endNumbers.length >= 2) {
    const sorted = [...endNumbers].sort((a, b) => b - a);
    const withVat = sorted[0];
    const preVat = sorted[1];
    const vat = withVat - preVat;
    if (vat > 0 && vat < withVat) {
      return { preVat, vat, withVat };
    }
  }

  return null;
}

/**
 * Build line items from the invoice sections.
 * Each section (sales commissions, additional fees, description)
 * contributes line items with descriptions and amounts.
 */
function extractLineItems(text: string): ClientParsedLineItem[] {
  const items: ClientParsedLineItem[] = [];

  // Look for rows with percentage and amounts
  // Pattern: description text followed by numbers
  // Common line item patterns in Wolt invoices:
  //   "15,187.54 2,316.74 18.00% 12,870.80 64,354.00 %20 חולשמ ,תוריש ימד"
  //   (visual RTL of "דמי שירות, משלוח 20%")
  //
  // We look for lines with multiple numbers that include an 18% VAT indicator

  // Extract percentage-based commission lines
  // Format: total vat vat% preVat sales description
  const commissionLinePattern =
    /([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(\d+\.\d{2})%\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(.+)/g;

  let match: RegExpExecArray | null;
  while ((match = commissionLinePattern.exec(text)) !== null) {
    const preVat = parseNumber(match[4]);
    const description = match[6].trim();

    // Skip section totals (סה"כ / כ"סה)
    if (description.includes('כ"סה') || description.includes('סה"כ')) {
      continue;
    }

    if (preVat > 0) {
      items.push({
        date: null,
        description,
        amount: preVat,
        commission: preVat,
      });
    }
  }

  return items;
}

/**
 * Parse a Wolt commission invoice PDF.
 *
 * Extracts the grand total (pre-VAT and with-VAT), franchisee name,
 * billing period, and individual line items from the commission invoice.
 *
 * @param buffer - PDF file buffer
 * @param mimeType - MIME type (should be application/pdf)
 * @returns Parsed commission invoice data
 */
export async function parseWoltInvoice(
  buffer: Buffer,
  mimeType: string
): Promise<ClientDocumentProcessingResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const data = await pdfParse(buffer);
    const text = data.text as string;

    if (!text || text.length < 50) {
      errors.push("לא ניתן לחלץ טקסט מקובץ ה-PDF של חשבונית וולט");
      return { success: false, data: null, errors, warnings };
    }

    // Verify this looks like a Wolt commission invoice
    const isWoltInvoice =
      text.includes("Wolt") ||
      text.includes("וולט") ||
      text.includes("טלוו");

    if (!isWoltInvoice) {
      warnings.push("המסמך לא נראה כחשבונית וולט - ממשיך בניתוח");
    }

    // Extract franchisee name
    const franchiseeName = extractFranchiseeName(text);
    if (!franchiseeName) {
      warnings.push("לא זוהה שם הזכיין מחשבונית וולט");
    }

    // Extract period
    const period = extractPeriod(text);
    if (!period) {
      warnings.push("לא זוהתה תקופת החיוב בחשבונית וולט");
    }

    // Extract invoice and allocation numbers
    const invoiceNumber = extractInvoiceNumber(text);
    const allocationNumber = extractAllocationNumber(text);

    // Extract grand total - this is the critical extraction
    const grandTotal = extractGrandTotal(text);

    if (!grandTotal || grandTotal.preVat === 0) {
      errors.push("לא נמצא סכום חשבונית בחשבונית וולט");
      return { success: false, data: null, errors, warnings };
    }

    // Extract line items for detail
    const lineItems = extractLineItems(text);

    // If no line items found, create a single summary line item
    if (lineItems.length === 0) {
      lineItems.push({
        date: null,
        description: `חשבונית עמלות וולט${invoiceNumber ? ` מס' ${invoiceNumber}` : ""}${allocationNumber ? ` | הקצאה ${allocationNumber}` : ""}`,
        amount: grandTotal.preVat,
        commission: grandTotal.preVat,
      });
    }

    // Validate: line items sum should roughly match preVat total
    const lineItemsSum = lineItems.reduce((sum, item) => sum + item.commission, 0);
    if (lineItems.length > 1 && Math.abs(lineItemsSum - grandTotal.preVat) > 1) {
      warnings.push(
        `סכום שורות הפירוט (${lineItemsSum.toFixed(2)}) שונה מסכום החשבונית (${grandTotal.preVat.toFixed(2)})`
      );
    }

    return {
      success: true,
      data: {
        franchiseeName: franchiseeName || "לא זוהה",
        totalAmount: grandTotal.preVat,
        commissionAmount: grandTotal.preVat,
        commissionRate: 0, // Multiple rates in invoice, can't pick one
        netAmount: grandTotal.withVat,
        periodMonth: period?.month,
        periodYear: period?.year,
        lineItems,
        rawText: text,
      },
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(
      `שגיאה בקריאת PDF חשבונית וולט: ${error instanceof Error ? error.message : String(error)}`
    );
    return { success: false, data: null, errors, warnings };
  }
}
