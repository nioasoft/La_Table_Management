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

import { createRequire } from "node:module";
import type { ClientDocumentProcessingResult, ClientParsedLineItem } from "./types";

// Import from /lib/pdf-parse.js directly — the package's index.js runs a
// debug file-read at module load when `module.parent` is null (breaks Turbopack builds).
const pdfParse = createRequire(import.meta.url)("pdf-parse/lib/pdf-parse.js");

/**
 * Dynamic imports for OCR dependencies. String-variable imports prevent
 * Turbopack/webpack from trying to bundle WASM/native packages at build time.
 */
const PDFJS_MODULE = "pdfjs-dist/legacy/build/pdf.mjs";
const TESSERACT_MODULE = "tesseract.js";
const SHARP_MODULE = "sharp";

async function loadPdfjs() {
  return import(/* webpackIgnore: true */ PDFJS_MODULE);
}
async function loadTesseract() {
  return import(/* webpackIgnore: true */ TESSERACT_MODULE);
}
async function loadSharp() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(/* webpackIgnore: true */ SHARP_MODULE);
  return (mod.default ?? mod) as typeof import("sharp");
}

/**
 * Extract the first embedded image from a PDF via pdfjs-dist and re-encode
 * the raw pixel buffer as PNG so tesseract can consume it. Returns null
 * if no image XObject is present on page 1.
 */
async function extractImageFromPDF(buffer: Buffer): Promise<Buffer | null> {
  const pdfjsLib = await loadPdfjs();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) })
    .promise;
  const page = await doc.getPage(1);
  const ops = await page.getOperatorList();
  const OPS = pdfjsLib.OPS;

  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] === OPS.paintImageXObject) {
      const imgName = ops.argsArray[i][0] as string;
      const imgData = await new Promise<{
        data: Uint8Array;
        width: number;
        height: number;
      } | null>((resolve) => page.objs.get(imgName, resolve));

      if (imgData?.data && imgData.width && imgData.height) {
        const { data, width, height } = imgData;
        const pixels = width * height;
        const channels = data.length / pixels;
        if (channels !== 3 && channels !== 4) continue;
        const sharp = await loadSharp();
        return await sharp(Buffer.from(data), {
          raw: { width, height, channels: channels as 3 | 4 },
        })
          .png()
          .toBuffer();
      }
    }
  }
  return null;
}

/**
 * Render page 1 of a PDF to a PNG at 2× scale for OCR. Used when no image
 * XObject is present (e.g. iLovePDF invoices embed the page differently).
 */
async function renderPdfPageToPng(buffer: Buffer): Promise<Buffer | null> {
  try {
    const pdfjsLib = await loadPdfjs();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) })
      .promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const canvasMod: any = await import(
      /* webpackIgnore: true */ "@napi-rs/canvas"
    ).catch(() => null);
    if (!canvasMod) return null;

    const canvas = canvasMod.createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.render({ canvasContext: ctx as any, viewport }).promise;
    return canvas.toBuffer("image/png");
  } catch {
    return null;
  }
}

async function ocrImage(imageBuffer: Buffer): Promise<string> {
  const tess = await loadTesseract();
  const recognize = tess.default?.recognize ?? tess.recognize;
  const { data } = await recognize(imageBuffer, "heb+eng");
  return data.text;
}

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
    const pdfData = await pdfParse(buffer);
    let text = pdfData.text as string;

    // Image-only PDFs (e.g. invoices routed through iLovePDF) lose the text
    // layer. Fall back to OCR; the OCR output is in normal LTR order and
    // the patterns below handle it uniformly with the text-layer path.
    if (!text || text.length < 50) {
      try {
        let imageBuffer = await extractImageFromPDF(buffer);
        if (!imageBuffer) {
          imageBuffer = await renderPdfPageToPng(buffer);
        }
        if (!imageBuffer) {
          errors.push("לא ניתן לחלץ טקסט או תמונה מקובץ ה-PDF של האט");
          return { success: false, data: null, errors, warnings };
        }
        const ocrText = await ocrImage(imageBuffer);
        if (!ocrText || ocrText.length < 50) {
          errors.push("OCR לא הצליח לחלץ טקסט מחשבונית האט");
          return { success: false, data: null, errors, warnings };
        }
        warnings.push("טקסט חולץ באמצעות OCR (חשבונית מתמונה)");
        text = ocrText;
      } catch (ocrError) {
        errors.push(
          `חילוץ טקסט נכשל ו-OCR לא זמין: ${ocrError instanceof Error ? ocrError.message : String(ocrError)}`
        );
        return { success: false, data: null, errors, warnings };
      }
    }

    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    // ---------------------------------------------------------------
    // Franchisee name
    // ---------------------------------------------------------------
    // Layouts seen in HAAT invoices:
    //   A) Same line:   "לכבוד: פט ויני עזריאלי בע"מ"
    //   B) Next line:   "לכבוד:" then the name on the line below
    //   C) OCR column-mix: the two-column header is flattened so the
    //      "לכבוד:" line is immediately followed by the right-column
    //      label ("תאריך חשבונית: 31/03/26"), and the actual business
    //      name sits at the start of the NEXT line — but that next line
    //      ALSO has right-column content trailing it
    //      (e.g. "פט ויני עזריאלי בע"מ תאריך הדפסה: 07/04/26").
    //   D) Visual-reversed RTL output where "דובכל" appears at the end.
    //
    // "Right-column" labels we trim from the name: תאריך, שעת, מספר/מס',
    // פעיל, פרטים, טלפון, Email, Haifa.

    // JS \b only triggers on ASCII word chars, so for Hebrew keywords we
    // use explicit boundary chars (whitespace, colon, hyphen, end).
    /** Strip right-column metadata that OCR flattens onto the name line. */
    const cleanNameSegment = (raw: string): string =>
      raw
        .replace(/\s+(?:תאריך|שעת|מספר|מס['׳.]?|פרטים|טלפון|Email|Haifa|פעיל)(?:[\s:\-]|$).*$/i, "")
        .replace(/[,،]/g, "")
        .replace(/ח\.?פ\.?.*$/, "")
        .replace(/ת\.?ז\.?.*$/, "")
        .trim();

    /** A captured segment that STARTS with a label keyword is column-mix noise, not the name. */
    const isColumnMixNoise = (raw: string): boolean =>
      /^(?:תאריך|שעת|מספר|מס['׳.]?|פרטים|טלפון|Email|Haifa|פעיל)(?:[\s:\-]|$)/i.test(raw.trim());

    let franchiseeName = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const lekavod = line.match(/לכבוד[:\s]+(.+)/);
      if (lekavod && lekavod[1].trim().length > 0) {
        const captured = lekavod[1].trim();
        if (isColumnMixNoise(captured) && i + 1 < lines.length) {
          // Case C: fall through to the next line, which starts with the name.
          const nextClean = cleanNameSegment(lines[i + 1]);
          if (nextClean.length > 0) {
            franchiseeName = nextClean;
            break;
          }
        }
        const cleaned = cleanNameSegment(captured);
        if (cleaned.length > 0) {
          franchiseeName = cleaned;
          break;
        }
      }

      // Case B: label-only line, name on the next line
      if (/^לכבוד\s*:?\s*$/.test(line) && i + 1 < lines.length) {
        const nextClean = cleanNameSegment(lines[i + 1]);
        if (nextClean.length > 0) {
          franchiseeName = nextClean;
          break;
        }
      }

      // Case D: visual-reversed "NAME ... דובכל"
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

    // Normalize OCR-mangled "SI" prefix. Tesseract renders "SI266007620" as
    // "5!266007620", "5[266007620", "5|266007620" etc., and sometimes drops
    // the "I" altogether. HAAT invoice numbers are always "SI" followed by
    // 6+ digits, so we rebuild the prefix whenever we've captured something
    // that looks like a numeric suffix with 8+ digits.
    if (invoiceNumber && !/^SI\d+$/i.test(invoiceNumber)) {
      const digits = invoiceNumber.replace(/\D/g, "");
      if (digits.length >= 8 && /^[5S][^0-9]?\d{8,}$/i.test(invoiceNumber)) {
        invoiceNumber = `SI${digits.slice(1)}`;
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
    // After discount takes priority. Tolerate OCR mangling of "אחרי" —
    // tesseract has been seen turning it into "‎nx‏" or similar garbage —
    // by accepting any short token between "מחיר" and "הנחה".
    const afterDiscountMatch =
      text.match(/מחיר\s+אחרי\s+הנחה[:\s]*([\d,]+\.?\d*)/) ||
      text.match(/מחיר\s+\S{1,6}\s+הנחה[:\s]*([\d,]+\.?\d*)/);
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
    // OCR-tolerant: tesseract occasionally mangles "מע"מ" into junk like
    // "n"yn" and reverses the parens, so the normal-order match fails.
    // Anchor on the "18%" VAT rate — HAAT VAT is always 18%, so this
    // avoids accidentally matching unrelated percent-number pairs such as
    // the "0.01%-( 0.10-" discount line.
    if (vatAmount === 0) {
      const vatLooseMatch = text.match(
        /[()]?\s*18(?:\.0+)?%\s*[()]?\s*(?:[^\d\n]*\s)?₪?\s*([\d,]+\.\d{2})/
      );
      if (vatLooseMatch) {
        vatAmount = parseFloat(vatLooseMatch[1].replace(/,/g, ""));
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

    // Arithmetic truth: when we have BOTH grand total and VAT, the
    // post-discount pre-VAT is exactly `grand - VAT`. Prefer that over the
    // regex-extracted pre-VAT whenever the difference can't be explained
    // (e.g. OCR captured the pre-discount "מחיר כולל" instead of the
    // post-discount "מחיר אחרי הנחה"). The real pre-VAT = grand − VAT.
    if (grandTotal > 0 && vatAmount > 0) {
      const arithmeticPreVat = Math.round((grandTotal - vatAmount) * 100) / 100;
      if (Math.abs(arithmeticPreVat - preVatTotal) > 0.02) {
        preVatTotal = arithmeticPreVat;
      }
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
