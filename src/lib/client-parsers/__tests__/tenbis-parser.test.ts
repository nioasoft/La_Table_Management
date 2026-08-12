import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseTenbisFile,
  findRestaurantSections,
  parseTenbisSections,
} from "../tenbis-parser";

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
 * Regression for Reut 2026-08-12: "בתן ביס לא נקלטו מספרי הקצאה".
 *
 * From the July-2026 period the TENBIS client_report slot holds the
 * franchisee's own ezcount tax invoice, not 10bis's transaction report. This
 * parser had no anchors for that layout, so those files failed with
 * "לא נמצאו סכומים" — no amounts and, crucially, no מספר הקצאה, which is
 * column K of the journal-entries Hashavshevet export.
 *
 * Fixture is the real production file (ezcount 10017, קינג קונג חדרה).
 */
describe("parseTenbisFile — ezcount tax invoice in the report slot", () => {
  function loadPdf(name: string): Buffer {
    return readFileSync(resolve(fixturesDir, name));
  }

  it("delegates an ezcount invoice to the ezcount parser and keeps the allocation number", async () => {
    const result = await parseTenbisFile(
      loadPdf("tenbis-ezcount-invoice-10017-hadera-2026-07.pdf"),
      "application/pdf",
    );

    expect(result.success).toBe(true);
    expect(result.data?.allocationNumber).toBe("213027501");
    expect(result.data?.invoiceNumber).toBe("10017");
    expect(result.data?.totalAmount).toBeCloseTo(25064, 2);
    expect(result.data?.periodMonth).toBe(7);
    expect(result.data?.periodYear).toBe(2026);
  });

  it("still parses a real 10bis transaction report as a report", async () => {
    const result = await parseTenbisFile(
      loadPdf("tenbis-single-hadera-2026-07.pdf"),
      "application/pdf",
    );
    // The delegation must not swallow the reports: the ezcount parser reads
    // ₪44.9M of garbage out of this file.
    expect(result.success).toBe(true);
    expect(result.data?.totalAmount).toBeCloseTo(25064.1, 2);
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

/**
 * Regression for the July 2026 Azrieli incident: 10bis stopped sending one
 * file per branch and started sending a single entity-level PDF holding a
 * section per restaurant. The old parser kept the LAST restaurant name it saw
 * and filed the entity's whole ₪30,132 onto that branch (נתנזון, 169.9% above
 * its Tabit figure) while ויני got no report at all.
 *
 * Both fixtures are the real production files.
 */
describe("parseTenbisSections", () => {
  function loadPdf(name: string): Buffer {
    return readFileSync(resolve(fixturesDir, name));
  }

  it("splits a combined entity report into one section per restaurant", async () => {
    const sections = await parseTenbisSections(
      loadPdf("tenbis-combined-entity-azrieli-2026-07.pdf"),
    );

    expect(sections).toHaveLength(2);
    expect(sections.map((s) => s.name)).toEqual([
      "ויני חיפה",
      "נתנזון בורגר שופ חיפה",
    ]);

    // Verified against Tabit for the same period: ויני ₪19,725.50 and
    // נתנזון ₪11,164 — both within 2.5%, the same band the single-file
    // reports hit in May and June.
    expect(sections[0].totalAmount).toBeCloseTo(19233.55, 2);
    expect(sections[1].totalAmount).toBeCloseTo(10898.45, 2);

    // The split must preserve the entity's own commission base exactly.
    const sum = sections.reduce((acc, s) => acc + s.totalAmount, 0);
    expect(sum).toBeCloseTo(30132, 2);
  });

  it("carries each restaurant's own commission, not the entity's", async () => {
    const sections = await parseTenbisSections(
      loadPdf("tenbis-combined-entity-azrieli-2026-07.pdf"),
    );
    expect(sections[0].commissionAmount).toBeCloseTo(2207.32, 2);
    expect(sections[1].commissionAmount).toBeCloseTo(1216.72, 2);
  });

  /**
   * The invariant that keeps the multi-tenant path honest: on a
   * single-restaurant report the section total must equal what the ordinary
   * single-file parser stores. That is NOT the section's gross sales — this
   * fixture grosses ₪26,139 but its commission base is ₪25,064.10, because
   * 10bis nets off HappyHour-on-the-house at entity level. Returning gross
   * would silently inflate every branch it touched.
   */
  it("returns the commission base, not gross sales, for a single restaurant", async () => {
    const pdf = loadPdf("tenbis-single-hadera-2026-07.pdf");
    const sections = await parseTenbisSections(pdf);
    const single = await parseTenbisFile(pdf, "application/pdf");

    expect(sections).toHaveLength(1);
    expect(sections[0].totalAmount).toBeCloseTo(25064.1, 2);
    expect(sections[0].totalAmount).toBeCloseTo(single.data!.totalAmount, 2);
  });

  it("a single-restaurant report is not treated as multi-tenant", async () => {
    const sections = await parseTenbisSections(
      loadPdf("tenbis-single-hadera-2026-07.pdf"),
    );
    // processMultiTenantReport bails below 2 — this is what keeps every
    // ordinary report on the normal single-franchisee path.
    expect(sections.length).toBeLessThan(2);
  });
});
