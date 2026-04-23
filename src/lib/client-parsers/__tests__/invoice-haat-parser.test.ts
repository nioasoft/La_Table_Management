/**
 * HAAT commission invoice parser tests.
 *
 * Regression: parser only matched the franchisee when it appeared on the
 * SAME line as "לכבוד:". Some HAAT PDFs put the label and the name on
 * separate lines:
 *   לכבוד:
 *   פט ויני עזריאלי בע"מ
 * In that layout the same-line regex returned nothing and the email-inbound
 * fallback chain failed to identify the franchisee at all.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseHaatFile } from "../invoice-haat-parser";

describe("parseHaatFile — Pat Vinni Azrieli SI266007620 (text-layer)", () => {
  it("extracts the franchisee from the line AFTER 'לכבוד:' when label is on its own line", async () => {
    const buf = readFileSync(
      resolve(__dirname, "fixtures/haat-pat-vinni-azrieli-SI266007620.pdf")
    );
    const result = await parseHaatFile(buf, "application/pdf");

    expect(result.success).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.data?.franchiseeName).not.toMatch(/האאט|האט/);
    expect(result.data?.franchiseeName).toMatch(/פט ויני עזריאלי/);
  });

  // Regression: pdf-parse output for this invoice puts numeric values on
  // one line and the matching Hebrew label on the NEXT line, so every
  // "LABEL: VALUE" regex in the parser missed. The "largest numbers"
  // fallback coincidentally returned the right number (1342.00 appears
  // twice in the doc as both ₪-prefixed and plain), but that was luck.
  // With the line-based value-before-label pass, the three totals are
  // extracted properly and the headline amount equals grand total (incl.
  // VAT) — NOT the pre-VAT subtotal.
  it("extracts grand total (incl. VAT) as headline — not pre-VAT — from RTL text-layer layout", async () => {
    const buf = readFileSync(
      resolve(__dirname, "fixtures/haat-pat-vinni-azrieli-SI266007620.pdf")
    );
    const result = await parseHaatFile(buf, "application/pdf");

    expect(result.success).toBe(true);
    // Grand total (incl. VAT) = 1342.00 — the number the franchisee pays
    // and the number the user reconciles against.
    expect(result.data?.totalAmount).toBeCloseTo(1342.0, 2);
    expect(result.data?.netAmount).toBeCloseTo(1342.0, 2);
    expect(result.data?.commissionAmount).toBeCloseTo(1342.0, 2);
  });
});

/**
 * OCR-fallback fixtures.
 *
 * Regression: HAAT invoices routed through iLovePDF lose the text layer and
 * become a single 2480x3509 JPEG. The parser had no OCR path at all, so it
 * returned "לא ניתן לחלץ טקסט" and the invoice ended up with NULL amounts
 * in the DB.
 *
 * After the fix:
 * - Raw RGBA pixel data from pdfjs is re-encoded as PNG via sharp, then
 *   handed to tesseract.
 * - Franchisee extraction tolerates OCR's two-column flattening (the
 *   "לכבוד:" line typically swallows the right-column "תאריך חשבונית:" on
 *   the same row, with the actual name sitting at the start of the NEXT
 *   row, followed by right-column metadata which we strip).
 * - "מע"מ" label can be mangled by OCR (e.g. "n"yn"); the 18% VAT-rate
 *   anchor lets us still capture the amount.
 * - Pre-VAT defers to the arithmetic truth `grandTotal - VAT` when we have
 *   both, so a mangled "אחרי הנחה" label doesn't cost us the correct
 *   post-discount pre-VAT value.
 * - SI invoice numbers like "SI266007629" are reconstructed from OCR
 *   mangling like "5!266007629" / "5266007627".
 *
 * OCR is slow (~10-20s per fixture), so use a generous timeout.
 */
describe("parseHaatFile — OCR fixtures (image-only)", () => {
  const OCR_TIMEOUT = 60_000;

  it(
    "Nathanson Haifa SI266007629 — OCR + amounts + invoice number",
    async () => {
      const buf = readFileSync(
        resolve(__dirname, "fixtures/haat-nathanson-SI266007629.pdf")
      );
      const result = await parseHaatFile(buf, "application/pdf");

      expect(result.success).toBe(true);
      expect(result.warnings.some((w) => w.includes("OCR"))).toBe(true);
      // Franchisee extraction must SKIP the column-mix noise ("תאריך חשבונית:")
      // and pick up the actual legal entity on the next line.
      expect(result.data?.franchiseeName).not.toMatch(/^תאריך/);
      expect(result.data?.franchiseeName).toMatch(/פט ויני עזריאלי/);
      // Headline amount is the WITH-VAT grand total (what the franchisee
      // actually pays and what gets reconciled). Pre-VAT remains extracted
      // internally for arithmetic checks but is no longer the primary.
      expect(result.data?.totalAmount).toBeCloseTo(844.0, 2);
      expect(result.data?.netAmount).toBeCloseTo(844.0, 2);
      expect(result.data?.commissionAmount).toBeCloseTo(844.0, 2);
      expect(
        (result.data as { invoiceNumber?: string } | null | undefined)
          ?.invoiceNumber
      ).toBe("SI266007629");
    },
    OCR_TIMEOUT
  );

  it(
    "Kastra Tomai SI266007627 — OCR with mangled 'מע\"מ' label",
    async () => {
      const buf = readFileSync(
        resolve(__dirname, "fixtures/haat-kastra-tomai-SI266007627.pdf")
      );
      const result = await parseHaatFile(buf, "application/pdf");

      expect(result.success).toBe(true);
      // OCR mangles "קסטרא טומאיי" → "קסטרא טומאוי" — fuzzy matcher will
      // still catch it downstream, we just confirm the shape here.
      expect(result.data?.franchiseeName).toMatch(/קסטרא/);
      // Headline = with-VAT grand total (12,752), not pre-VAT (10,806.78).
      expect(result.data?.totalAmount).toBeCloseTo(12752.0, 2);
      expect(result.data?.netAmount).toBeCloseTo(12752.0, 2);
      expect(result.data?.commissionAmount).toBeCloseTo(12752.0, 2);
      expect(
        (result.data as { invoiceNumber?: string } | null | undefined)
          ?.invoiceNumber
      ).toBe("SI266007627");
    },
    OCR_TIMEOUT
  );
});
