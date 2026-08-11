import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTenbisFile, findRestaurantSections } from "../tenbis-parser";

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

/**
 * Text below is written the way pdf-parse emits it: RTL Hebrew in VISUAL
 * order, so every line reads reversed. Copied from the real July 2026
 * Azrieli report (21657_20260701_20260731.pdf).
 */
describe("findRestaurantSections", () => {
  const ENTITY_TITLE = "\u05de''\u05d1\u05e2 \u05e2\u05d6\u05e8\u05d9\u05d0\u05dc\u05d9 \u05d5\u05d9\u05e0\u05d9 \u05e4\u05d8 \u05dc\u05de\u05e1\u05e2\u05d3\u05ea \u05e2\u05e1\u05e7\u05d0\u05d5\u05ea \u05e4\u05d9\u05e8\u05d5\u05d8";
  const DATE_RANGE = "31/07/2026 - 01/07/2026 \u05dd\u05d9\u05db\u05d9\u05e8\u05d0\u05ea\u05d4 \u05df\u05d9\u05d1";
  const SECTION_MARKER = "\u05db\u05dc\u05dc\u05d9 \u05e2\u05e1\u05e7\u05d0\u05d5\u05ea \u05e4\u05d9\u05e8\u05d5\u05d8";
  const header = (name: string) =>
    `${name} \u05dc\u05de\u05e1\u05e2\u05d3\u05ea \u05e2\u05e1\u05e7\u05d0\u05d5\u05ea \u05e4\u05d9\u05e8\u05d5\u05d8`;

  it("finds both restaurants in a combined entity report", () => {
    const text = [
      ENTITY_TITLE,
      DATE_RANGE,
      header("\u05d7\u05d9\u05e4\u05d4 \u05d5\u05d9\u05e0\u05d9"),
      SECTION_MARKER,
      "01/07188178----366-48.44",
      header("\u05d7\u05d9\u05e4\u05d4 \u05e9\u05d5\u05e4 \u05d1\u05d5\u05e8\u05d2\u05e8 \u05e0\u05ea\u05e0\u05d6\u05d5\u05df"),
      SECTION_MARKER,
      "01/0784------84-9.91",
    ].join("\n");

    expect(findRestaurantSections(text)).toEqual([
      "\u05d7\u05d9\u05e4\u05d4 \u05d5\u05d9\u05e0\u05d9",
      "\u05d7\u05d9\u05e4\u05d4 \u05e9\u05d5\u05e4 \u05d1\u05d5\u05e8\u05d2\u05e8 \u05e0\u05ea\u05e0\u05d6\u05d5\u05df",
    ]);
  });

  it("does not count the entity title as a restaurant section", () => {
    // The title is followed by the date range, never by "פירוט עסקאות כללי".
    const text = [ENTITY_TITLE, DATE_RANGE, header("\u05e8\u05d2\u05d1\u05d4 \u05d5\u05d9\u05e0\u05d9"), SECTION_MARKER].join("\n");
    expect(findRestaurantSections(text)).toEqual(["\u05e8\u05d2\u05d1\u05d4 \u05d5\u05d9\u05e0\u05d9"]);
  });

  it("returns a single section for an ordinary one-restaurant report", () => {
    const text = [ENTITY_TITLE, DATE_RANGE, header("\u05d7\u05d3\u05e8\u05d4 \u05e7\u05d5\u05e0\u05d2 \u05e7\u05d9\u05e0\u05d2"), SECTION_MARKER].join("\n");
    expect(findRestaurantSections(text)).toHaveLength(1);
  });

  it("returns nothing when the document has no section headers", () => {
    expect(findRestaurantSections("some unrelated text\nand another line")).toEqual([]);
  });
});
