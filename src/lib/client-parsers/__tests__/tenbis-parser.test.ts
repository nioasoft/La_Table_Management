import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTenbisFile } from "../tenbis-parser";

const fixturesDir = resolve(__dirname, "fixtures");

function loadHtml(name: string): Buffer {
  return Buffer.from(readFileSync(resolve(fixturesDir, name), "utf-8"), "utf-8");
}

describe("parseTenbisFile (HTML body branch)", () => {
  /**
   * Regression for Reut's 2026-05-05 outage: every 10bis "דו''ח חודשי
   * למסעדה" inbound from service@10bis.co.il was failing with
   * "מייל ... ללא קבצים מצורפים ולא נמצאו לינקים להורדה". 10bis switched
   * from Mandrill-attached PDFs to HTML-body delivery. This fixture is
   * the actual email body from gmail_sync_log b486654e (Resend email
   * a6063d71-ae67-497a-9687-9c1bcd6e3cc2).
   */
  it("extracts franchisee + period + totals from current 10bis HTML body shape", async () => {
    const html = loadHtml("tenbis-html-natanzon-2026-04.html");
    const result = await parseTenbisFile(html, "text/html");

    expect(result.success).toBe(true);
    expect(result.data?.franchiseeName).toContain("נתנזון");
    expect(result.data?.periodMonth).toBe(4);
    expect(result.data?.periodYear).toBe(2026);
    expect(result.data?.totalAmount).toBe(110);
    // Commission = 10bis commission (9.74) + terminal fee (117) = 126.74
    expect(result.data?.commissionAmount).toBeCloseTo(126.74, 2);
    // Net to pay (negative — restaurant owes 10bis nothing this period after fees)
    expect(result.data?.netAmount).toBeCloseTo(-16.74, 2);
  });

  it("dispatches to HTML branch when content sniffs as HTML even without mimeType hint", async () => {
    const html = loadHtml("tenbis-html-natanzon-2026-04.html");
    const result = await parseTenbisFile(html, "application/octet-stream");
    expect(result.success).toBe(true);
    expect(result.data?.franchiseeName).toContain("נתנזון");
  });
});
