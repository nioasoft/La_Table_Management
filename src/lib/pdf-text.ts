/**
 * One place where a PDF becomes text.
 *
 * Every parser used to call `pdf-parse` directly, which meant an encoding
 * change at a single supplier had to be discovered, diagnosed and patched
 * per parser. It also meant nobody could tell "the text came out damaged"
 * from "the layout changed".
 *
 * WHY THE REPAIR EXISTS — ezcount, 2026-09-02.
 * ezcount changed the font encoding of the CUSTOMER-NAME block only. The
 * rest of the invoice (issuer header, item rows) stayed clean Hebrew, so
 * nothing looked broken until franchisee resolution failed on 8 Mishloha
 * commission invoices for period 08/2026 (Castra Tomai, Vini Regba, Mina
 * Tomei Station, King Kong Motzkin/Big/Horev/Hadera). What pdf-parse emits:
 *
 *   August (fine)   לכבוד: "קסטרא טומאיי בע""מ )מינה טומיי סטיישן חיפה("
 *   September       ×ž×•×¦×§×™×Ÿ(×§×™× ×’ ×§×•× ×’
 *                   (×ž×•×¦×§×™×Ÿ ×‘×¢"×ž
 *
 * Those are UTF-8 bytes rendered through cp1252 — classic mojibake. Mapping
 * the glyphs back to bytes and decoding as UTF-8 recovers `(מוצקין בע"מ`.
 *
 * ezcount issues for Wolt, HAAT and 10bis too, so this lives here rather
 * than in the Mishloha parser: fixing one parser only defers the next
 * incident to a different client.
 */
import { createRequire } from "node:module";

// The package's index.js runs a debug harness on import; go straight to lib.
const pdfParse = createRequire(import.meta.url)("pdf-parse/lib/pdf-parse.js");

/**
 * cp1252 glyph → byte, for the 0x80–0x9F range where cp1252 differs from
 * latin-1. Hebrew's UTF-8 continuation bytes land here constantly
 * (ם=0xDD 0x9D, ן=0xD7 0x9F, מ=0xD7 0x9E …), so without this map most
 * Hebrew mojibake is unrecoverable.
 *
 * The three combining forms at the end are not cp1252 proper: some text
 * extractors emit U+0308 instead of the spacing diaeresis U+00A8 (0xA8),
 * U+02DA instead of U+00B0, U+0327 instead of U+00B8. Observed in the
 * ezcount output above.
 */
const CP1252_TO_BYTE = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
  [0x0308, 0xa8], [0x02da, 0xb0], [0x0327, 0xb8],
]);

const utf8Strict = new TextDecoder("utf-8", { fatal: true });

function decodeStrict(bytes: number[]): string | null {
  try {
    return utf8Strict.decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

/**
 * A character that could be one byte of a mojibake run: anything the
 * cp1252 map covers, plus everything below U+0100. Real Hebrew (U+0590+)
 * is above that, so a line that mixes clean Hebrew with a mojibake island
 * splits into runs naturally and only the island is touched.
 */
function isRunChar(code: number): boolean {
  return code < 0x100 || CP1252_TO_BYTE.has(code);
}

function repairRun(run: string): string {
  const bytes: number[] = [];
  for (const ch of run) {
    const code = ch.codePointAt(0)!;
    bytes.push(CP1252_TO_BYTE.get(code) ?? code);
  }

  const direct = decodeStrict(bytes);
  if (direct !== null) return direct;

  // Some extractors flatten NBSP (0xA0) to a plain space. 0xA0 is a very
  // common Hebrew continuation byte (ן=0xD7 0xA0, ר=0xD7 0xA8 …), so a run
  // like "×§×™× ×’" only decodes once the spaces that follow a lead byte are
  // put back. Without this pass "קינג" stays unrecoverable.
  const restored = bytes.map((b, i) =>
    b === 0x20 && i > 0 && bytes[i - 1] >= 0xc0 ? 0xa0 : b,
  );
  return decodeStrict(restored) ?? run;
}

/**
 * Repair UTF-8-as-cp1252 mojibake in extracted PDF text.
 *
 * Conservative by design: a run is only attempted when it contains a
 * plausible UTF-8 lead byte (U+00C0–U+00FF), and any run that fails to
 * decode as strict UTF-8 is returned untouched. Latin text ("Mishloha.digital"),
 * numbers and clean Hebrew are never rewritten.
 */
export function repairMojibake(text: string): string {
  if (!text) return text;

  let out = "";
  let run = "";

  const flush = () => {
    if (!run) return;
    out += /[À-ÿ]/.test(run) ? repairRun(run) : run;
    run = "";
  };

  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch !== "\n" && ch !== "\r" && isRunChar(code)) {
      run += ch;
    } else {
      flush();
      out += ch;
    }
  }
  flush();

  return out;
}

export interface PdfText {
  text: string;
  /** True when repairMojibake actually changed something — an early signal
   *  that a supplier changed its PDF encoding. Surfaced by the pipeline
   *  health cron so the next change alerts instead of failing silently. */
  mojibakeRepaired: boolean;
}

/**
 * Extract text from a PDF, repairing mojibake. Drop-in replacement for a
 * direct `pdfParse(buffer)` call — the returned object exposes `.text`.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfText> {
  const data = await pdfParse(buffer);
  const raw = (data.text as string) ?? "";
  const text = repairMojibake(raw);
  const mojibakeRepaired = text !== raw;

  if (mojibakeRepaired) {
    // Loud on purpose. A repair means a supplier changed how it encodes
    // text, and the repair is a best effort — the next change may not be
    // recoverable. Better to see it in the logs the week it starts than
    // the month a franchisee's documents go missing.
    console.warn(
      "[pdf-text] repaired mojibake in extracted PDF text — a supplier changed its PDF encoding",
    );
  }

  return { text, mojibakeRepaired };
}
