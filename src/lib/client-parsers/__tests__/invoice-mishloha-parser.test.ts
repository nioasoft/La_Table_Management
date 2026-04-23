/**
 * Mishloha commission invoice parser tests.
 *
 * Regression: parser was extracting "דיב אנד רד פרוג'קטס בע\"מ" (Mishloha's
 * legal name = the issuer) as the franchisee. For commission invoices the
 * franchisee is the RECIPIENT, which appears on the "לכבוד:" line itself —
 * NOT on the lines before it (those belong to the issuer = Mishloha).
 *
 * The previous logic was correct for sales invoices (where the franchisee
 * is the issuer at the top of the page) but wrong for commission invoices
 * where the roles are reversed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseMishlohaFile } from "../invoice-mishloha-parser";

describe("parseMishlohaFile (commission invoice) — text-layer fixtures", () => {
  it("King Kong Big 157945 — extracts franchisee from 'לכבוד'", async () => {
    const buf = readFileSync(
      resolve(__dirname, "fixtures/mishloha-king-big-157945.pdf")
    );
    const result = await parseMishlohaFile(buf, "application/pdf");

    expect(result.success).toBe(true);
    expect(result.data?.franchiseeName).not.toMatch(/דיב אנד רד/);
    expect(result.data?.franchiseeName).toMatch(/קינג קונג ביג/);
    expect(result.data?.totalAmount).toBeCloseTo(3666.93, 2);
  });

  it("Vinni Regba 155897 — extracts franchisee from 'לכבוד'", async () => {
    const buf = readFileSync(
      resolve(__dirname, "fixtures/mishloha-vinni-regba-155897.pdf")
    );
    const result = await parseMishlohaFile(buf, "application/pdf");

    expect(result.success).toBe(true);
    expect(result.data?.franchiseeName).not.toMatch(/דיב אנד רד/);
    expect(result.data?.franchiseeName).toMatch(/ויני רגבה/);
  });
});

/**
 * OCR-fallback fixtures.
 *
 * Regression: jsPDF 2.5.1 mishloha invoices (Hyp / Easy Count 11 templates,
 * produced from March 2026 onward) embed the whole page as a 2480x3507 JPEG
 * and carry no text layer. pdf-parse returned < 50 chars, the old OCR path
 * passed raw RGBA bytes to tesseract (→ "Error attempting to read image"),
 * and the amounts ended up NULL in the DB (franchisee "needs_review" state).
 *
 * After the fix: raw RGBA is re-encoded as PNG via sharp, OCR output flows
 * through the main parsing pipeline (OCR text is label-before-amount in
 * normal LTR order, so the LTR regexes match it), and the grandTotal mPDF
 * pattern is anchored on end-of-line so the VAT line above doesn't get
 * misread as the grand total.
 *
 * OCR is slow (~10-20s per fixture on a laptop), so use a generous timeout.
 */
describe("parseMishlohaFile (commission invoice) — OCR fixtures (image-only)", () => {
  const OCR_TIMEOUT = 60_000;

  it(
    "King Kong Hadera 157941 — OCR + amount extraction",
    async () => {
      const buf = readFileSync(
        resolve(__dirname, "fixtures/mishloha-kingkong-hadera-157941.pdf")
      );
      const result = await parseMishlohaFile(buf, "application/pdf");

      expect(result.success).toBe(true);
      expect(result.warnings.some((w) => w.includes("OCR"))).toBe(true);
      expect(result.data?.franchiseeName).toMatch(/קינג קונג חדרה/);
      expect(result.data?.totalAmount).toBeCloseTo(1616.81, 2);
      expect(result.data?.commissionAmount).toBeCloseTo(246.63, 2);
      expect(result.data?.netAmount).toBeCloseTo(1370.18, 2);
    },
    OCR_TIMEOUT
  );

  it(
    "Vinni Azrieli 155898 — OCR + amount extraction",
    async () => {
      const buf = readFileSync(
        resolve(__dirname, "fixtures/mishloha-vinni-azrieli-155898.pdf")
      );
      const result = await parseMishlohaFile(buf, "application/pdf");

      expect(result.success).toBe(true);
      expect(result.data?.franchiseeName).toMatch(/פט ויני עזריאלי/);
      expect(result.data?.totalAmount).toBeCloseTo(1517.35, 2);
      expect(result.data?.commissionAmount).toBeCloseTo(231.46, 2);
    },
    OCR_TIMEOUT
  );

  it(
    "King Kong Horev 157942 — OCR + amount extraction",
    async () => {
      const buf = readFileSync(
        resolve(__dirname, "fixtures/mishloha-kingkong-horev-157942.pdf")
      );
      const result = await parseMishlohaFile(buf, "application/pdf");

      expect(result.success).toBe(true);
      expect(result.data?.franchiseeName).toMatch(/קינג קונג חורב/);
      // Regression guard: VAT (639.49) must NOT be captured as totalAmount.
      // The earlier mPDF grandTotal pattern matched "<amount>\nסה"כ:" without
      // requiring the label to sit on a line of its own, so it silently
      // picked the VAT line that immediately precedes "סה"כ:" in OCR output.
      expect(result.data?.totalAmount).toBeCloseTo(4192.22, 2);
      expect(result.data?.totalAmount).not.toBeCloseTo(639.49, 2);
      expect(result.data?.commissionAmount).toBeCloseTo(639.49, 2);
    },
    OCR_TIMEOUT
  );

  it(
    "Kastra Tomai 157029 — OCR + amount extraction",
    async () => {
      const buf = readFileSync(
        resolve(__dirname, "fixtures/mishloha-kastra-tomai-157029.pdf")
      );
      const result = await parseMishlohaFile(buf, "application/pdf");

      expect(result.success).toBe(true);
      expect(result.data?.franchiseeName).toMatch(/קסטרא טומאיי/);
      expect(result.data?.totalAmount).toBeCloseTo(9467.20, 2);
      expect(result.data?.commissionAmount).toBeCloseTo(1444.15, 2);
    },
    OCR_TIMEOUT
  );
});
