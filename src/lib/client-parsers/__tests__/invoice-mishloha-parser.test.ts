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

describe("parseMishlohaFile (commission invoice) — King Kong Big 157945", () => {
  it("extracts the recipient (franchisee) from the 'לכבוד' line, not the issuer", async () => {
    const buf = readFileSync(
      resolve(__dirname, "fixtures/mishloha-king-big-157945.pdf")
    );
    const result = await parseMishlohaFile(buf, "application/pdf");

    expect(result.success).toBe(true);
    expect(result.data).not.toBeNull();
    // PDF "לכבוד" line: "קינג קונג קרית אתא)קינג קונג ביג בע\"\"מ("
    // The legal entity (קינג קונג ביג בע"מ) takes priority over the branch
    // name and matches an existing franchisee.
    expect(result.data?.franchiseeName).not.toMatch(/דיב אנד רד/);
    expect(result.data?.franchiseeName).toMatch(/קינג קונג ביג/);
    expect(result.data?.totalAmount).toBeCloseTo(3666.93, 2);
  });
});
