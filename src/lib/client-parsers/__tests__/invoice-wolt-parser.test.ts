/**
 * Wolt commission invoice parser tests.
 *
 * Regression: Castra Tomai March 2026 invoice was parsed with VAT (₪35,302.92)
 * stored as commission instead of pre-VAT total (₪196,127.17).
 * Root cause: extractGrandTotal regex captured the "18.00" VAT percentage as
 * one of three amount numbers.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseWoltInvoice } from "../invoice-wolt-parser";

describe("parseWoltInvoice — Castra Tomai 2026-03", () => {
  it("stores with-VAT totals so they're comparable to report amounts", async () => {
    const buf = readFileSync(
      resolve(
        __dirname,
        "fixtures/wolt-castra-tomai-2026-03.pdf"
      )
    );
    const result = await parseWoltInvoice(buf, "application/pdf");

    expect(result.success).toBe(true);
    expect(result.data).not.toBeNull();
    // PDF "סכום חשבונית" row: pre-VAT 196,127.17 / VAT 35,302.92 / total 231,430.09
    // Reports in this system are with-VAT, so the invoice side is normalized
    // to with-VAT as well to keep the comparison apples-to-apples.
    expect(result.data?.totalAmount).toBeCloseTo(231430.09, 2);
    expect(result.data?.commissionAmount).toBeCloseTo(231430.09, 2);
    // netAmount keeps the pre-VAT breakdown for reference
    expect(result.data?.netAmount).toBeCloseTo(196127.17, 2);
  });
});
