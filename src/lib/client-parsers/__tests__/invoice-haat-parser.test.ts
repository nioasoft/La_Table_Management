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

describe("parseHaatFile — Pat Vinni Azrieli SI266007620", () => {
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
});
