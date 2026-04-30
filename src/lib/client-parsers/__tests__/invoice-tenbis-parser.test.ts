/**
 * Tenbis (תן-ביס / 10bis) commission invoice parser tests.
 *
 * Convention: headline is the WITH-VAT grand total — the franchisee actually
 * pays the gross amount, and reconciliation already splits with/without-VAT
 * columns from this single gross figure (see commit b6fbfe8). Mirrors the
 * Cibus / HAAT / Mishloha / Wolt convention.
 *
 * Real fixture: Invoice 500105038 dated 24/03/2026, issued by 10 ביס to
 * "קינג קונג חורב בע"מ". Single line item "דוח פברואר" (February report).
 *   Pre-VAT 3,978.81 + VAT 18% 716.19 = 4,695.00 grand total.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseTenbisInvoice } from "../invoice-tenbis-parser";

describe("parseTenbisInvoice — King Kong Horev 500105038", () => {
  it("extracts franchisee, with-VAT headline and period from a real Tnbis tax invoice", async () => {
    const buf = readFileSync(
      resolve(__dirname, "fixtures/tenbis-king-kong-500105038.pdf")
    );
    const result = await parseTenbisInvoice(buf, "application/pdf");

    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.data).not.toBeNull();

    // Franchisee — from "לכבוד: קינג קונג חורב בע"מ"
    expect(result.data?.franchiseeName).toBe('קינג קונג חורב בע"מ');

    // Headline = with-VAT grand total (4,695.00).
    // totalAmount = commissionAmount = netAmount, all equal to grand total.
    expect(result.data?.totalAmount).toBeCloseTo(4695.0, 2);
    expect(result.data?.commissionAmount).toBeCloseTo(4695.0, 2);
    expect(result.data?.netAmount).toBeCloseTo(4695.0, 2);

    // Period — line item is "דוח פברואר" (February). Invoice dated 24/03/2026
    // is the issue date (one month after the report period).
    expect(result.data?.periodMonth).toBe(2);
    expect(result.data?.periodYear).toBe(2026);

    // Below the ₪10,000 allocation-number threshold — should be undefined.
    expect(result.data?.allocationNumber).toBeUndefined();
  });
});
