/**
 * Detect which CLIENT a franchisee-issued ezcount invoice is addressed to,
 * from the "לכבוד" recipient line of the PDF.
 *
 * Why: every franchisee issues ALL its invoices from one ezcount account
 * with a single running sequence — some to משלוחה, some to Haat Delivery —
 * and every "[העתק] חשבונית מס ... מאת <זכיין>" copy email is sent to the
 * fixed address mishlocha@inbound.latable.co.il. Sender/to-address routing
 * therefore files Haat-bound invoices under the MISHLOCHA client (May 2026:
 * חורב's Haat invoice 10051 landed in — and overwrote — its Mishloha
 * report slot). Only the document content knows the real recipient.
 *
 * pdf-parse line shapes observed in production (RTL handling varies):
 *   Hebrew recipient :  "לכבוד: משלוחה )דיב אנד רד פרוגקטס בעמ("
 *   Latin recipient  :  "Haat Delivery :לכבוד"        (flipped order)
 *   Franchisee recip.:  "לכבוד: \"פאט ויני חיפה(...)\"" (no client token → null)
 * Some PDFs reverse Hebrew entirely ("דובכל") — both forms are handled.
 */

// `require` is unavailable in ESM-mode tsx scripts. Use `createRequire` so
// this module loads cleanly under both Next.js and tsx (recovery scripts).
import { createRequire } from "node:module";
const pdfParse = createRequire(import.meta.url)("pdf-parse/lib/pdf-parse.js");

const RECIPIENT_MARKERS = ["לכבוד", "דובכל"]; // normal + RTL-reversed

/**
 * Client-code → recipient tokens (lower-cased compare). Hebrew tokens
 * include the RTL-reversed form. Tokens must be distinctive enough to
 * never appear in a franchisee name — that's why there's no "תן ביס"-style
 * generic word here without the legal/brand context.
 */
const RECIPIENT_CLIENT_TOKENS: ReadonlyArray<{
  code: string;
  tokens: readonly string[];
}> = [
  {
    code: "HAAT",
    tokens: ["haat delivery", "האאט דילברי", "ירבליד טאאה", "516136603"],
  },
  {
    code: "MISHLOCHA",
    tokens: ["משלוחה", "החולשמ", "דיב אנד רד", "דר דנא ביד", "514570290"],
  },
  {
    code: "WOLT",
    tokens: ["wolt enterprises", "וולט אנטרפרייזס"],
  },
  {
    // 10bis went self-billed in period 07/2026, so franchisees started
    // issuing ezcount invoices to it too — "לכבוד: תן ביס קו איל בע''מ".
    // Without this entry the detector returned null and every one of those
    // invoices kept the channel default (MISHLOCHA) and took over Mishloha's
    // report slot for that franchisee+month, which then bounced Mishloha's
    // REAL invoice off the overwrite guard. July 2026: #10062 ויני רגבה,
    // #10056 קינג קונג ביג, #10017 קינג קונג חדרה and #10002 קינג קונג מוצקין
    // all landed as Mishloha reports carrying 10bis figures, and Mishloha's
    // own #10064 / #10057 / #10018 / #10003 were rejected behind them.
    // Kept qualified ("קו איל" / "בע") rather than a bare "תן ביס", per the
    // rule above; the ח.פ is the RTL-proof anchor.
    code: "TENBIS",
    tokens: [
      "תן ביס קו איל",
      "ליא וק סיב ןת",
      "תן ביס בע",
      "עב סיב ןת",
      "512963489",
    ],
  },
];

/**
 * Pure text variant (exported for tests). Scans the line containing the
 * first recipient marker (both sides of the marker — Latin recipients are
 * flipped to BEFORE "לכבוד" by pdf-parse) plus the following line, and
 * returns the matching client code, or null when the recipient is not a
 * known client (i.e. a franchisee — normal commission invoices).
 */
export function detectRecipientClientCodeFromText(
  text: string,
): string | null {
  if (!text) return null;
  const lines = text.split("\n");
  const markerLineIdx = lines.findIndex((line) =>
    RECIPIENT_MARKERS.some((m) => line.includes(m)),
  );
  if (markerLineIdx < 0) return null;

  const window = [
    lines[markerLineIdx] ?? "",
    lines[markerLineIdx + 1] ?? "",
  ]
    .join("\n")
    .toLowerCase();

  for (const { code, tokens } of RECIPIENT_CLIENT_TOKENS) {
    if (tokens.some((t) => window.includes(t.toLowerCase()))) {
      return code;
    }
  }
  return null;
}

/**
 * Buffer variant for the inbound webhook. Returns null on any extraction
 * failure (image-only PDFs etc.) — callers must treat null as "keep the
 * channel-derived client". The overwrite guard still protects against the
 * worst case when detection fails.
 */
export async function detectRecipientClientCodeFromPdf(
  buffer: Buffer,
): Promise<string | null> {
  try {
    const data = await pdfParse(buffer);
    const text = (data.text as string) ?? "";
    if (text.length < 30) return null;
    return detectRecipientClientCodeFromText(text);
  } catch {
    return null;
  }
}
