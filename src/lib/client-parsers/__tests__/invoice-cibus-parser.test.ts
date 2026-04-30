/**
 * Cibus/Plaxie commission invoice parser tests.
 *
 * Regression: pdf-parse emits the totals block of real Cibus invoices in a
 * "values-above-labels" layout that NONE of the original LABEL→VALUE
 * patterns matched. The parser failed with "לא נמצאו סכומים" and the
 * email-inbound flow never created a document.
 *
 * Real layout (from SI266046922):
 *
 *     12,838.99
 *     2,311.01
 *     סה"כ מחיר
 *     (18.00%) מע"מ
 *      ש"ח15,150.00סה"כ לחשבונית
 *
 * After the fix:
 * - Pre-VAT (12,838.99) and VAT (2,311.01) are captured together via a
 *   paired-numbers-above-paired-labels regex.
 * - Grand total (15,150.00) is captured from the run-together
 *   "ש"ח15,150.00סה"כ לחשבונית" form (currency, number, label glued).
 * - Franchisee extraction (from "לכבוד:" or "תאור פרויקט:") was already
 *   correct for this layout.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseCibusInvoice } from "../invoice-cibus-parser";

describe("parseCibusInvoice — Castra Tomai SI266046922 (text-layer)", () => {
  it("extracts franchisee, totals and metadata from values-above-labels layout", async () => {
    const buf = readFileSync(
      resolve(__dirname, "fixtures/cibus-castra-tomai-SI266046922.pdf")
    );
    const result = await parseCibusInvoice(buf, "application/pdf");

    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.data).not.toBeNull();

    // Franchisee — comes from "תאור פרויקט: קסטרא טומאיי בע"מ" (Pattern B)
    expect(result.data?.franchiseeName).toBe('קסטרא טומאיי בע"מ');

    // Headline amount is the WITH-VAT grand total (15,150.00) — what the
    // franchisee actually pays and what reconciliation compares against.
    // totalAmount = commissionAmount = netAmount, all equal to grand total.
    expect(result.data?.totalAmount).toBeCloseTo(15150.0, 2);
    expect(result.data?.commissionAmount).toBeCloseTo(15150.0, 2);
    expect(result.data?.netAmount).toBeCloseTo(15150.0, 2);

    // Period — from "01/03/26-31/03/26" (March 2026)
    expect(result.data?.periodMonth).toBe(3);
    expect(result.data?.periodYear).toBe(2026);

    // Israeli tax allocation number (the 9-digit value labelled
    // "מספר הקצאה:" — not the longer 17-digit signature ID).
    expect(result.data?.allocationNumber).toBe("113046810");
  });
});

describe("parseCibusInvoice — KingKong Big SI266047807 (legal-entity preference)", () => {
  it('prefers "לכבוד" with בע"מ over "תאור פרויקט" descriptor', async () => {
    // Regression: this real Cibus invoice was routed to KingKong Horev
    // because the parser blindly preferred "תאור פרויקט: קינג קונג -חיפה -
    // חיפה" over "לכבוד: קינג קונג ביג בע"מ", and "חיפה" matched Horev's
    // alias list. The fix prefers the legal-entity name (בע"מ) when present.
    //
    // Bonus regression: the old char class included \s, which caused "בברכה"
    // (greeting) two lines below "תאור פרויקט" to bleed into the captured
    // group, producing 'קינג קונג -חיפה - חיפה\nבברכה'. The new char class
    // only allows horizontal whitespace, so the captured name terminates at
    // the newline.
    const buf = readFileSync(
      resolve(__dirname, "fixtures/cibus-kingkong-big-SI266047807.pdf")
    );
    const result = await parseCibusInvoice(buf, "application/pdf");

    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.data?.franchiseeName).toBe('קינג קונג ביג בע"מ');

    // Headline = with-VAT grand total (1,816.00).
    expect(result.data?.totalAmount).toBeCloseTo(1816.0, 2);
    expect(result.data?.commissionAmount).toBeCloseTo(1816.0, 2);
    expect(result.data?.netAmount).toBeCloseTo(1816.0, 2);

    // Period — from "01/03/26-31/03/26" (March 2026).
    expect(result.data?.periodMonth).toBe(3);
    expect(result.data?.periodYear).toBe(2026);
  });
});
