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

/**
 * Regression: Wolt Nathanson invoice was auto-assigned to "פט ויני עזריאלי
 * חיפה" (wrong franchisee) because the PDF is billed to the shared legal
 * entity "פט ויני עזריאלי בע"מ". The branch-line "חיפה | NATANZON | נתנזון"
 * is the only disambiguating signal, and the old extractor stopped at the
 * first pipe (which fenced off the Hebrew "נתנזון" on the far side).
 *
 * The fix collects the ~3 lines after "לכבוד" and flattens pipes so both
 * the legal entity AND the "NATANZON" / "נתנזון" trade tokens end up in the
 * search string, letting the fuzzy matcher's token-sequence alias pass
 * pick up the Nathanson-only alias "NATANZON" exactly.
 */
describe("parseWoltInvoice — Nathanson 2026-03 (shared-legal-entity disambiguation)", () => {
  it("extracts BOTH legal entity and branch tokens from the 'לכבוד' block", async () => {
    const buf = readFileSync(
      resolve(__dirname, "fixtures/wolt-nathanson-haifa-2026-03.pdf")
    );
    const result = await parseWoltInvoice(buf, "application/pdf");

    expect(result.success).toBe(true);
    const extracted = result.data?.franchiseeName ?? "";
    // Must include the disambiguating branch tokens, not just legal entity.
    expect(extracted).toMatch(/NATANZON/);
    expect(extracted).toMatch(/נתנזון/);
    // And still include the legal entity so legitimate Azrieli invoices
    // (which DO lack the Nathanson tokens) keep matching correctly.
    expect(extracted).toMatch(/עזריאלי/);

    // Amounts should be unchanged by the name-extraction refactor.
    expect(result.data?.totalAmount).toBeCloseTo(11384.15, 2);
  });
});
