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

    // Pre-VAT subtotal (the commission charged before VAT)
    expect(result.data?.totalAmount).toBeCloseTo(12838.99, 2);
    expect(result.data?.commissionAmount).toBeCloseTo(12838.99, 2);

    // Grand total (incl. VAT) = what the franchisee actually pays
    expect(result.data?.netAmount).toBeCloseTo(15150.0, 2);

    // Period — from "01/03/26-31/03/26" (March 2026)
    expect(result.data?.periodMonth).toBe(3);
    expect(result.data?.periodYear).toBe(2026);

    // Israeli tax allocation number (the 9-digit value labelled
    // "מספר הקצאה:" — not the longer 17-digit signature ID).
    expect(result.data?.allocationNumber).toBe("113046810");
  });
});
