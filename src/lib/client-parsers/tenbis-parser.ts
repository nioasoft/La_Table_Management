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
//
// `require` is unavailable in ESM-mode tsx (which the reprocess scripts use).
// Use `createRequire(import.meta.url)` so this module loads cleanly under
// both Next.js (CJS-via-bundler) and tsx ESM. See memory:
// gotcha-inbound-email-pipeline (pdf-parse + tsx ESM).
import { createRequire } from "node:module";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = createRequire(import.meta.url)("pdf-parse/lib/pdf-parse.js");

/**
 * Strip an HTML body to plain text using the same conservative rules
 * as cibus-parser. Used by the HTML branch of parseTenbisFile.
 */
function stripTenbisHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<\/th>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "");
}

/**
 * Parse a Tenbis monthly report delivered as the email HTML body.
 *
 * As of 2026-05-05, 10bis sends monthly reports directly in the email
 * body (subject: "דו''ח חודשי למסעדה", from: service@10bis.co.il).
 * Earlier deliveries used Mandrill links to PDF attachments — those
 * still work via the PDF branch below.
 *
 * The HTML body uses LTR table cells with logical Hebrew (no pdf-parse
 * RTL reversal) so the regex shapes are simpler than the PDF parser:
 *   - Restaurant name: appears in heading
 *   - Period: "DD/MM/YYYY - DD/MM/YYYY"
 *   - Totals block (after "סיכום:"):
 *       'סה"כ עסקאות N ש"ח'
 *       'עמלת תן ביס N ש"ח'
 *       'טרמינל N ש"ח'
 *       'סה"כ לתשלום: N ש"ח'   (may be negative)
 */
function parseTenbisHtmlBody(
  html: string
): ClientDocumentProcessingResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const text = stripTenbisHtml(html);

  // Franchisee name — the line under "פירוט עסקאות למסעדת <name>".
  let franchiseeName = "";
  const nameMatch = text.match(
    /פירוט\s+עסקאות\s+למסעדת\s+([^\n\r]+?)\s+בין\s+התאריכים/
  );
  if (nameMatch?.[1]) {
    franchiseeName = nameMatch[1].trim();
  }
  if (!franchiseeName) {
    // Defensive: heading sometimes appears before the structured row.
    const headingMatch = text.match(
      /למסעדת\s+([֐-׿][֐-׿ "'\-\d/]+?)\s+בין\s+התאריכים/
    );
    if (headingMatch?.[1]) {
      franchiseeName = headingMatch[1].trim();
    }
  }

  // Period: "01/04/2026 - 30/04/2026" — period_month from the start date.
  let periodMonth: number | undefined;
  let periodYear: number | undefined;
  const periodMatch = text.match(
    /(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/
  );
  if (periodMatch) {
    periodMonth = parseInt(periodMatch[2]);
    periodYear = parseInt(periodMatch[3]);
  }

  // Totals — read from the "סיכום:" block at the bottom of the report.
  const moneyRe = /(-?[\d,.]+)\s*ש"ח/;
  const totalAmount = (() => {
    const m = text.match(/סה"כ\s+עסקאות\s+(-?[\d,.]+)\s*ש"ח/);
    return m ? parseFloat(m[1].replace(/,/g, "")) : 0;
  })();
  const commissionTenbis = (() => {
    const m = text.match(/עמלת\s+תן\s+ביס\s+(-?[\d,.]+)\s*ש"ח/);
    return m ? parseFloat(m[1].replace(/,/g, "")) : 0;
  })();
  const terminalFee = (() => {
    const m = text.match(/טרמינל\s+(-?[\d,.]+)\s*ש"ח/);
    return m ? parseFloat(m[1].replace(/,/g, "")) : 0;
  })();
  const netAmountFromTotal = (() => {
    const m = text.match(/סה"כ\s+לתשלום\s*:?\s*(-?[\d,.]+)\s*ש"ח/);
    return m ? parseFloat(m[1].replace(/,/g, "")) : 0;
  })();
  void moneyRe;

  const totalCommission = commissionTenbis + terminalFee;
  const netAmount =
    netAmountFromTotal !== 0
      ? netAmountFromTotal
      : totalAmount > 0
      ? totalAmount - totalCommission
      : 0;
  const commissionRate =
    totalAmount > 0
      ? Math.round((totalCommission / totalAmount) * 10000) / 100
      : 0;

  if (
    totalAmount === 0 &&
    commissionTenbis === 0 &&
    terminalFee === 0 &&
    netAmountFromTotal === 0
  ) {
    // A genuinely empty period (no orders) is still a valid report — the
    // restaurant just had nothing to reconcile. Match cibus-parser's
    // forgiving behaviour so franchisee identification still completes.
    warnings.push("דוח תן-ביס ללא תנועה — אפס סכומים");
  }

  if (!franchiseeName) {
    warnings.push("לא זוהה שם הזכיין מהמסמך");
  }

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
      allocationNumber: extractAllocationNumber(text),
    },
    errors,
    warnings,
  };
}

/**
 * Find every RESTAURANT section in a 10bis PDF report.
 *
 * From July 2026, 10bis stopped sending one file per branch and started
 * sending a single entity-level PDF holding one section per restaurant.
 * The Azrieli entity (ח.פ 516161361) is the known case: until June it got
 * `21657_*.pdf` (ויני עזריאלי חיפה) and `29896_*.pdf` (נתנזון עזריאלי חיפה)
 * separately; in July both arrived inside `21657_20260701_20260731.pdf` and
 * no 29896 file was sent at all.
 *
 * The old name extractor kept the LAST `פירוט עסקאות למסעדת X` line in the
 * document, so the whole entity total (₪30,132) was filed onto the last
 * section's branch — נתנזון, whose Tabit figure was ₪11,164 (169.9% off) —
 * while ויני was left with no report at all. Nothing failed and nothing was
 * logged: the parse succeeded and the document looked complete.
 *
 * Structure, as pdf-parse emits it (RTL text in visual order, so each line
 * reads reversed):
 *
 *   [1]  "מ''בע עזריאלי ויני פט למסעדת עסקאות פירוט"   ← entity title
 *   [2]  "31/07/2026 - 01/07/2026 םיכיראתה ןיב"        ← date range
 *   [5]  "חיפה ויני למסעדת עסקאות פירוט"                ← restaurant 1
 *   [6]  "כללי עסקאות פירוט"                            ← section marker
 *   [80] "חיפה שופ בורגר נתנזון למסעדת עסקאות פירוט"    ← restaurant 2
 *   [81] "כללי עסקאות פירוט"                            ← section marker
 *
 * A restaurant section header is always followed by `פירוט עסקאות כללי`;
 * the entity title is followed by the date range. That marker is the
 * discriminator — matching on `בע"מ` would not work, since a restaurant may
 * legitimately be named with it.
 */
export function findRestaurantSections(text: string): string[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Reversed forms, because pdf-parse emits RTL in visual order.
  const headerRe = /^(.+?)\s+למסעדת\s+עסקאות\s+פירוט$/;
  const sectionMarker = "כללי עסקאות פירוט";

  const names: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headerRe);
    if (!m) continue;
    if (lines[i + 1]?.startsWith(sectionMarker)) {
      names.push(m[1].trim());
    }
  }
  return names;
}

/**
 * Parse a Tenbis report.
 *
 * Dispatches to the HTML body parser when the input is the email body
 * (mimeType "text/html" or "text/plain", or content starting with
 * "<html"/"<body"). Falls through to the legacy PDF parser otherwise.
 */
export async function parseTenbisFile(
  buffer: Buffer,
  mimeType: string
): Promise<ClientDocumentProcessingResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // HTML body branch (10bis monthly reports as of 2026-05-05).
  const isHtml =
    mimeType.toLowerCase().includes("html") ||
    /^\s*<(?:!doctype|html|body)/i.test(buffer.toString("utf-8").slice(0, 256));
  if (isHtml) {
    return parseTenbisHtmlBody(buffer.toString("utf-8"));
  }

  try {
    const data = await pdfParse(buffer);
    const text = data.text as string;

    if (!text || text.length < 50) {
      errors.push("לא ניתן לחלץ טקסט מקובץ ה-PDF של תן-ביס");
      return { success: false, data: null, errors, warnings };
    }

    // 10bis emails carry two PDF shapes that share the same `from`/folder:
    //  1. Monthly transaction reports (Mandrill, contains "סה\"כ עסקאות"
    //     and "עמלת תן ביס") — what this parser is built for.
    //  2. Payment notifications ("הודעת תשלום") — list invoice references
    //     and a payment date, no transaction totals at all.
    // The notification has none of the regex anchors below, so it would
    // otherwise fall through to "לא נמצאו סכומים" and be saved as
    // needs_review. Worse, the dedup-replace in client-document-processor
    // would OVERWRITE a real monthly report for the same franchisee+period
    // if the notification happened to arrive after it. Reject upstream.
    if (text.includes("הודעת תשלום")) {
      warnings.push(
        'מסמך "הודעת תשלום" של תן ביס — לא דוח עסקאות, דולג ולא נשמר'
      );
      return {
        success: false,
        data: null,
        errors,
        warnings,
        skipPersist: true,
      };
    }

    // Extract the franchisee name(s) — see findRestaurantSections.
    //
    // A multi-restaurant report cannot be saved as one document: its totals
    // are entity-level, and `client_document` holds one client_report per
    // (client, franchisee, period). Filing the combined total onto any single
    // branch overstates that branch and erases the others — exactly the July
    // 2026 Azrieli incident this check exists to prevent.
    //
    // We deliberately do NOT try to split the amounts here. pdf-parse emits
    // the per-section day rows as delimiter-less digit runs
    // ("01/07188178----366-48.44",
    //  "סיכום15636.81374.8292-32571350.120560.6-2207.32")
    // where 188178 could as easily be 18|8178. Guessing a split would put
    // fabricated money into billing — strictly worse than parking the file.
    // A correct split needs a column-aware extractor (`pdftotext -layout`
    // reads it cleanly); see src/scripts/fix-azrieli-entity-july-2026.ts for
    // how July was split and verified against Tabit.
    //
    // So: refuse, and name every restaurant found, so whoever opens the
    // review queue knows what is inside without opening the PDF.
    const sections = findRestaurantSections(text);
    if (sections.length > 1) {
      errors.push(
        `דוח 10ביס מאוחד לישות עם ${sections.length} מסעדות (${sections.join(", ")}) — ` +
          `הסכומים בקובץ הם ברמת הישות ולא ניתן לשייך אותם לזכיין יחיד. ` +
          `יש לפצל ידנית לפי הסקשנים בקובץ.`
      );
      return { success: false, data: null, errors, warnings };
    }

    let franchiseeName = sections[0] ?? "";
    if (!franchiseeName) {
      // Single-restaurant layouts that predate the "פירוט עסקאות כללי"
      // section marker: fall back to the last header line before the table.
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const m = line.match(/^([\u0590-\u05FF"']+(?:\s+[\u0590-\u05FF"']+)*)\s+למסעדת\s+עסקאות\s+פירוט$/);
        if (m) {
          franchiseeName = m[1].trim();
        }
        if (line.includes("הזמנות") && line.includes("משלוחים")) break;
      }
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
