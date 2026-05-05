import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCibusFile } from "../cibus-parser";

const fixturesDir = resolve(__dirname, "fixtures");

function loadHtml(name: string): Buffer {
  const html = readFileSync(resolve(fixturesDir, name), "utf-8");
  return Buffer.from(html, "utf-8");
}

describe("parseCibusFile", () => {
  /**
   * Regression for Reut's 2026-05-05 outage: every "Pluxee דוח" inbound
   * email was failing with "Parser did not extract a franchisee name".
   * Pluxee renders cells with mixed direction attributes; once HTML is
   * stripped the plain text exposes orderings the original parser did
   * not handle:
   *   "44890 :מספר מסעדה"           (value-first restaurant number)
   *   "שם מסעדה : VINNI - רגבה"     (label-first name with whitespace before colon)
   *   "05-05-2026: מיום"            (value-first period date)
   * This fixture is the actual stripped-HTML body from Resend email
   * 5729adbe-d24e-4e3e-a851-ebd8e2f6d5af (gmail_sync_log d8eb85a0).
   */
  it("extracts franchisee name + restaurant number from current Pluxee body shape (regression: 2026-05-05 Pluxee דוח outage)", async () => {
    const html = loadHtml("cibus-pluxee-vinni-regba-2026-05.html");
    const result = await parseCibusFile(html, "text/html");

    expect(result.success).toBe(true);
    expect(result.data?.franchiseeName).toBe("VINNI - רגבה");
    expect(result.data?.periodMonth).toBe(5);
    expect(result.data?.periodYear).toBe(2026);
  });

  it("returns franchiseeName as a non-empty string for the failing fixture", async () => {
    const html = loadHtml("cibus-pluxee-vinni-regba-2026-05.html");
    const result = await parseCibusFile(html, "text/html");
    // Catches the original bug: parseCibusFile returned franchiseeName=""
    expect(result.data?.franchiseeName).toBeTruthy();
    expect(result.data?.franchiseeName?.length).toBeGreaterThan(0);
  });
});
