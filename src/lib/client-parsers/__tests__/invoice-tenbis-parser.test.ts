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

/**
 * Regressions from Reut's 2026-08-11 report: "there is a report for every
 * branch but no invoice."
 *
 * 10bis dropped the "דוח <חודש>" line-item description during the July 2026
 * cycle — the path the test above covers. Without it the period falls back to
 * the invoice date, and two separate bugs then filed invoices under the wrong
 * month, where they collided with older invoices for the same franchisee and
 * were refused by the overwrite guard. Three of six July invoices were lost
 * that way.
 */
describe("parseTenbisInvoice — period derived from the invoice date", () => {
  const load = (name: string): Buffer =>
    readFileSync(resolve(__dirname, "fixtures", name));

  /**
   * 10bis issues on two schedules: on a month's LAST DAY it bills that month;
   * mid-month it bills the month before. The old fallback used the invoice
   * month for both, so June and July invoices competed for the same slot.
   */
  it("an invoice issued on the month's last day bills that month", async () => {
    // 400183008, dated 31/07/2026, ₪2,241 — קסטרא's real July invoice, parked
    // in the review queue while July showed a report and no invoice.
    const result = await parseTenbisInvoice(
      load("tenbis-invoice-400183008-kastra-2026-07.pdf"),
      "application/pdf",
    );
    expect(result.success).toBe(true);
    expect(result.data?.periodMonth).toBe(7);
    expect(result.data?.periodYear).toBe(2026);
    expect(result.data?.totalAmount).toBeCloseTo(2241, 2);
  });

  it("an invoice issued mid-month bills the previous month", async () => {
    // 500113381, dated 16/07/2026, ₪4,242.01 — חורב's JUNE invoice. The
    // 10/08/2026 payment advice confirms it settles the June cycle.
    const result = await parseTenbisInvoice(
      load("tenbis-invoice-500113381-horev-2026-06.pdf"),
      "application/pdf",
    );
    expect(result.success).toBe(true);
    expect(result.data?.periodMonth).toBe(6);
    expect(result.data?.periodYear).toBe(2026);
    expect(result.data?.totalAmount).toBeCloseTo(4242.01, 2);
  });

  /**
   * The month scan used a plain substring match, so 'קסטרא טומאיי בע"מ' —
   * which contains "מאי" inside "טומאיי" — resolved this July invoice to MAY.
   * It then collided with קסטרא's real May invoice and was refused.
   * 'מינה טומאיי' carries the identical trap.
   *
   * \b cannot fix this: JS word boundaries are ASCII-only and match between
   * two Hebrew letters.
   */
  it("does not read a month name out of the middle of a franchisee name", async () => {
    const result = await parseTenbisInvoice(
      load("tenbis-invoice-400183008-kastra-2026-07.pdf"),
      "application/pdf",
    );
    expect(result.data?.periodMonth).not.toBe(5);
  });
});
