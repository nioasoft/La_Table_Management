import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCrackPieFile } from "../crack-pie-parser";

const fixturesDir = resolve(__dirname, "fixtures");

const HEADER =
  '"סוג מסמך/תנועה","אסמכתא 1","אסמכתא 2","תאריך ערך",תיאור,"שיטת תשלום","סכום תשלום",מטבע,"שער מטבע","חובה (ש״ח)","זכות (ש״ח)",יתרה';

function csv(lines: string[]): Buffer {
  return Buffer.from([HEADER, ...lines].join("\n"), "utf-8");
}

const ymd = (d: Date | null) => [d!.getFullYear(), d!.getMonth() + 1, d!.getDate()];

describe("parseCrackPieFile — real ledger exports (cp1255 CSV, Sep 2026)", () => {
  it("takes the branch from the filename and one row per tax invoice", () => {
    const buffer = readFileSync(resolve(fixturesDir, "crack-pie-vini-azrieli-ledger.csv"));
    const r = parseCrackPieFile(buffer, 0.18, "ויני_עזריאלי_דוח_תנועות_לקוח.csv");

    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(2);
    expect(r.data.every((d) => d.franchisee === "ויני עזריאלי")).toBe(true);
    expect(r.data.map((d) => ymd(d.date))).toEqual([
      [2026, 9, 9],
      [2026, 9, 22],
    ]);
    // Ledger debits are invoice totals incl. VAT: net = gross / 1.18
    expect(r.data.map((d) => d.grossAmount)).toEqual([1003, 2785]);
    expect(r.data.map((d) => d.netAmount)).toEqual([850, 2360]);
    expect(r.summary.totalGrossAmount).toBe(3788); // the file's own סה״כ חובה
    expect(r.warnings).toHaveLength(0);
  });

  it("keeps each invoice's own date (Yehud has an October invoice)", () => {
    const buffer = readFileSync(resolve(fixturesDir, "crack-pie-vini-yehud-ledger.csv"));
    const r = parseCrackPieFile(buffer, 0.18, "ויני_יהוד_דוח_תנועות_לקוח.csv");

    expect(r.data.map((d) => ymd(d.date))).toEqual([
      [2026, 9, 16],
      [2026, 10, 6],
    ]);
    expect(r.summary.totalGrossAmount).toBe(3899);
  });

  it("cleans double underscores and a WhatsApp copy suffix from the filename", () => {
    const buffer = readFileSync(resolve(fixturesDir, "crack-pie-vini-yehud-ledger.csv"));
    const r = parseCrackPieFile(buffer, 0.18, "ויני_כרמיאל__דוח_תנועות_לקוח (1).csv");
    expect(r.data[0].franchisee).toBe("ויני כרמיאל");
  });
});

describe("parseCrackPieFile — document types", () => {
  it("counts credit notes negative and ignores receipts", () => {
    const r = parseCrackPieFile(
      csv([
        '"יתרת פתיחה",,,,,,,,,0,0,0',
        '"חשבונית מס",,1,2026-09-01,x,,1180,ILS,1,1180,0,-1180',
        '"חשבונית זיכוי",,2,2026-09-02,x,,118,ILS,1,0,118,-1062',
        'קבלה,,3,2026-09-03,x,העברה,1062,ILS,1,0,1062,0',
        'סה״כ,,,,,,,,,1180,1180,0',
      ]),
      0.18,
      "ויני_רגבה_דוח_תנועות_לקוח.csv"
    );
    expect(r.success).toBe(true);
    expect(r.data.map((d) => d.grossAmount)).toEqual([1180, -118]);
    expect(r.data.map((d) => d.netAmount)).toEqual([1000, -100]);
    expect(r.warnings).toHaveLength(0);
  });

  it("warns on an unknown document type instead of guessing", () => {
    const r = parseCrackPieFile(
      csv([
        '"חשבונית מס",,1,2026-09-01,x,,1180,ILS,1,1180,0,-1180',
        '"תעודת משלוח",,2,2026-09-02,x,,500,ILS,1,500,0,-1680',
      ]),
      0.18,
      "ויני_רגבה_דוח_תנועות_לקוח.csv"
    );
    expect(r.data).toHaveLength(1);
    expect(r.warnings.some((w) => w.details?.includes("תעודת משלוח"))).toBe(true);
  });

  it("warns when invoice debits don't add up to the file's total row", () => {
    const r = parseCrackPieFile(
      csv(['"חשבונית מס",,1,2026-09-01,x,,1180,ILS,1,1180,0,-1180', "סה״כ,,,,,,,,,9999,0,-9999"]),
      0.18,
      "ויני_רגבה_דוח_תנועות_לקוח.csv"
    );
    expect(r.success).toBe(true);
    expect(r.warnings.some((w) => w.code === "GRAND_TOTAL_MISMATCH" || w.details?.includes("9999"))).toBe(true);
  });
});

describe("parseCrackPieFile — guards", () => {
  it("fails when the filename carries no branch name", () => {
    const buffer = readFileSync(resolve(fixturesDir, "crack-pie-vini-azrieli-ledger.csv"));
    for (const name of [undefined, "דוח_תנועות_לקוח.csv"]) {
      const r = parseCrackPieFile(buffer, 0.18, name);
      expect(r.success).toBe(false);
      expect(r.errors[0].details).toContain("filename");
    }
  });

  it("rejects a ZIP with a clear message", () => {
    const r = parseCrackPieFile(Buffer.from("PK\u0003\u0004junk"), 0.18, "ויני.zip");
    expect(r.success).toBe(false);
    expect(r.errors[0].details).toContain("ZIP");
  });

  it("fails cleanly when the ledger header is missing", () => {
    const r = parseCrackPieFile(Buffer.from("a,b\n1,2"), 0.18, "ויני_רגבה_דוח_תנועות_לקוח.csv");
    expect(r.success).toBe(false);
    expect(r.errors[0].details).toContain("סוג מסמך");
  });
});
