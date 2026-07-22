import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseJumonFile } from "../jumon-parser";

const HEADERS = [
  "מס' לקוח", "שם לקוח", "מק'ט", "תאור מוצר משתנה", "סכום של כמות",
  " סכום של סכום (ש'ח) ", "אחוז עמלת ניהול ", 'סה"כ ניהול לפני מע"מ',
];

function xlsx(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseJumonFile — multi-sheet handling", () => {
  const mainSheet = [
    HEADERS,
    ["100", "מינה יהוד", "1", "אורז", "2", "1,000", "17%", "170"],
    ["", "", "2", "אצות", "1", "500", "17%", "85"],
    ["200", "קינג קונג חיפה", "1", "אורז", "1", "2,000", "17%", "340"],
  ];
  // Per-brand breakout: same King Kong customer, same totals
  const breakoutSheet = [
    HEADERS,
    ["200", "קינג קונג חיפה", "1", "אורז", "1", "2,000", "17%", "340"],
  ];

  it("skips a breakout sheet that duplicates customers with identical totals", () => {
    const r = parseJumonFile(xlsx({ "מינה טומאי": mainSheet, "קינג קונג": breakoutSheet }));
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(2); // no double count
    const kk = r.data.find(d => d.franchisee === "קינג קונג חיפה")!;
    expect(kk.netAmount).toBe(2000);
    expect(kk.preCalculatedCommission).toBe(340);
    expect(r.legacyWarnings).toHaveLength(0);
  });

  it("includes customers that appear only on a later sheet (new brand sheet)", () => {
    const newBrandSheet = [
      HEADERS,
      ["300", "פט ויני רגבה", "1", "אורז", "1", "700", "17%", "119"],
    ];
    const r = parseJumonFile(
      xlsx({ "מינה טומאי": mainSheet, "קינג קונג": breakoutSheet, "פט ויני": newBrandSheet })
    );
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(3);
    const pv = r.data.find(d => d.franchisee === "פט ויני רגבה")!;
    expect(pv.netAmount).toBe(700);
    expect(pv.preCalculatedCommission).toBe(119);
    expect(r.summary.totalNetAmount).toBe(1500 + 2000 + 700);
  });

  it("parses the new-branch layout (leading חודש column, name repeated on every row)", () => {
    const newBranchLayout = [
      ["חודש", "מס' לקוח", "שם לקוח", "מק'ט", "תאור מוצר משתנה", "כמות", "סכום (ש'ח)", "אחוז עמלת ניהול ", 'סה"כ ניהול לפני מע"מ'],
      ["יונ-26", "200801131", 'פט ויני עזריאלי בע"מ (חיפה)', "25036", "בצלים", "10", " 420.08 ", "17%", " 71.41 "],
      ["יונ-26", "200801131", 'פט ויני עזריאלי בע"מ (חיפה)', "5018101", "רוטב", "6", " 626.81 ", "17%", " 106.56 "],
      ["", "", "", "", "", "", "", "", " 177.97 "], // total row — no product, skipped
      ["", "תחילת פעילות חודש 06.26", "", "", "", "", "", "", ""],
    ];
    const r = parseJumonFile(xlsx({ "4-6.26": newBranchLayout }));
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(1);
    const azrieli = r.data[0];
    expect(azrieli.franchisee).toBe('פט ויני עזריאלי בע"מ (חיפה)');
    expect(azrieli.netAmount).toBe(1047); // 420.08 + 626.81 rounded — amounts, not quantities
    expect(azrieli.preCalculatedCommission).toBe(178);
  });

  it("sums repeated blocks of the same customer within one sheet (no drop, no warning)", () => {
    const twoBlocks = [
      HEADERS,
      ["100", "מינה יהוד", "1", "אורז", "2", "1,000", "17%", "170"],
      ["100", "מינה יהוד", "2", "אצות", "1", "500", "17%", "85"], // second block, same customer
    ];
    const r = parseJumonFile(xlsx({ ראשי: twoBlocks }));
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].netAmount).toBe(1500);
    expect(r.legacyWarnings).toHaveLength(0);
  });

  it("keeps first sheet's numbers and warns when a duplicate has different totals", () => {
    const conflicting = [
      HEADERS,
      ["200", "קינג קונג חיפה", "1", "אורז", "1", "9,999", "17%", "1,700"],
    ];
    const r = parseJumonFile(xlsx({ ראשי: mainSheet, פירוט: conflicting }));
    expect(r.success).toBe(true);
    const kk = r.data.find(d => d.franchisee === "קינג קונג חיפה")!;
    expect(kk.netAmount).toBe(2000); // first sheet wins
    expect(r.legacyWarnings.some(w => w.includes("different totals"))).toBe(true);
  });
});
