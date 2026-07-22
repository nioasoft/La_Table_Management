import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseFrescoFile } from "../fresco-parser";

/** Build an xlsx buffer from named sheets */
function xlsx(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const HEADER = ["תאריך", "מס' חשבונית", 'סכום (ש"ח)', null];

/** The brand-level summary sheet — has no block header, must contribute nothing */
const SUMMARY: unknown[][] = [
  ["סיכום חשבוניות לפי רשת", null, null],
  [null, null, null],
  ["רשת", "מספר חשבוניות", 'סה"כ (ש"ח)'],
  ["רשת ויני", 3, 3000],
  ['סה"כ כללי', null, 3000],
];

describe("parseFrescoFile — block layout (current export)", () => {
  const viniSheet: unknown[][] = [
    ["רשת ויני", null, null, null],
    [null, null, null, null],
    ['ויני חדרה מול החוף בע"מ', null, null, null],
    HEADER,
    [new Date(2026, 3, 19), "IN264001568", 1000, null],
    [new Date(2026, 3, 12), "IN264001751", 500, null], // earlier — becomes date
    [new Date(2026, 4, 2), "IN264002047", -100, null], // credit note, must count
    [null, 'סה"כ ויני חדרה מול החוף בע"מ', 1400, null],
    [null, null, null, null],
    ['ויני רגבה בע"מ', null, null, null],
    HEADER,
    [new Date(2026, 3, 20), "IN264001509", 2000, null],
    [null, 'סה"כ ויני רגבה בע"מ', 2000, null],
    [null, null, null, null],
    [null, 'סה"כ כללי רשת ויני', 3400, null],
  ];

  it("aggregates one row per franchisee across brand sheets", () => {
    const r = parseFrescoFile(xlsx({ סיכום: SUMMARY, ויני: viniSheet }), 0.18);

    expect(r.success).toBe(true);
    expect(r.legacyWarnings).toEqual([]);
    expect(r.data).toHaveLength(2);

    const hadera = r.data.find((d) => d.franchisee === 'ויני חדרה מול החוף בע"מ')!;
    expect(hadera.netAmount).toBe(1400); // 1000 + 500 - 100
    expect(hadera.grossAmount).toBe(1652); // 1400 * 1.18
    expect(hadera.originalAmount).toBe(1400);

    const regba = r.data.find((d) => d.franchisee === 'ויני רגבה בע"מ')!;
    expect(regba.netAmount).toBe(2000);

    expect(r.summary.totalNetAmount).toBe(3400);
  });

  it("uses the earliest invoice date in the block, without timezone drift", () => {
    const r = parseFrescoFile(xlsx({ ויני: viniSheet }), 0.18);
    const hadera = r.data.find((d) => d.franchisee === 'ויני חדרה מול החוף בע"מ')!;

    expect(hadera.date).not.toBeNull();
    expect(hadera.date!.getFullYear()).toBe(2026);
    expect(hadera.date!.getMonth()).toBe(3); // April
    expect(hadera.date!.getDate()).toBe(12);
  });

  it("honours the vatRate it is given", () => {
    const r = parseFrescoFile(xlsx({ ויני: viniSheet }), 0.17);
    const regba = r.data.find((d) => d.franchisee === 'ויני רגבה בע"מ')!;
    expect(regba.grossAmount).toBe(2340); // 2000 * 1.17
  });

  it('warns — but still parses — when a block disagrees with its own סה"כ row', () => {
    const r = parseFrescoFile(
      xlsx({
        ויני: [
          ['ויני רגבה בע"מ', null, null, null],
          HEADER,
          [new Date(2026, 3, 20), "IN1", 2000, null],
          [null, 'סה"כ ויני רגבה בע"מ', 9999, null],
        ],
      }),
      0.18
    );

    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].netAmount).toBe(2000);
    expect(r.legacyWarnings.some((w) => w.includes('ויני רגבה בע"מ'))).toBe(true);
  });

  it('warns when a sheet\'s blocks do not add up to its "סה"כ כללי" row', () => {
    const r = parseFrescoFile(
      xlsx({
        ויני: [
          ['ויני רגבה בע"מ', null, null, null],
          HEADER,
          [new Date(2026, 3, 20), "IN1", 2000, null],
          [null, 'סה"כ ויני רגבה בע"מ', 2000, null],
          [null, 'סה"כ כללי רשת ויני', 5000, null], // a block went missing
        ],
      }),
      0.18
    );

    expect(r.success).toBe(true);
    expect(r.legacyWarnings.some((w) => w.includes("כללי"))).toBe(true);
  });

  it("fails loudly when no block and no pivot can be found", () => {
    // The bug this replaces: the old parser read the summary sheet's invoice
    // COUNT column as an amount and reported success with garbage rows.
    const r = parseFrescoFile(xlsx({ סיכום: SUMMARY }), 0.18);

    expect(r.success).toBe(false);
    expect(r.data).toHaveLength(0);
    expect(r.legacyErrors[0]).toContain("לא נמצאו טבלאות");
  });
});

describe("parseFrescoFile — legacy גיליון2 pivot (historical files)", () => {
  it("falls back to the pivot layout and flags it", () => {
    const r = parseFrescoFile(
      xlsx({
        DataSheet: [["ignored"]],
        גיליון2: [
          ["תוויות שורה", "סכום של סכום (ש'ח)"],
          ['ויני רגבה בע"מ', 2000],
          ['ויני חדרה מול החוף בע"מ', 1400],
          ["סכום כולל", 3400],
        ],
      }),
      0.18
    );

    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(2);
    expect(r.summary.totalNetAmount).toBe(3400);
    expect(r.data[0].date).toBeNull();
    expect(r.legacyWarnings.some((w) => w.includes("גיליון2"))).toBe(true);
  });
});
