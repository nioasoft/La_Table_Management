import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseDageiHakibbutzimFile } from "../dagei-hakibbutzim-parser";

/**
 * The Q2-2026 export inserted a "מפתח לקוח" column, shifting every later
 * column right by one — the parser then summed מע"מ instead of the amount.
 * Both layouts must yield the same numbers.
 */
const LEGACY_HEADERS = [
  "",
  "סוג מסמך",
  "מספר מסמך",
  "תאריך מסמך",
  "מספר עוסק / ח.פ",
  "כתובת",
  "תגית",
  "אימייל",
  "טלפון",
  "נייד",
  "תיאור",
  "הערות",
  'אחוז מע"מ',
  'מע"מ',
  'סכום לפני מע"מ',
  "סכום",
];

// Same as legacy, plus "מפתח לקוח" before the business id.
const CURRENT_HEADERS = [
  ...LEGACY_HEADERS.slice(0, 4),
  "מפתח לקוח",
  ...LEGACY_HEADERS.slice(4),
];

function buildFile(headers: string[], rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([headers, ...rows]),
    "Report"
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseDageiHakibbutzimFile", () => {
  const legacyRow = [
    "מסמך פתוח",
    "חשבונית מס",
    27525,
    46203,
    "515289262",
    "קריון ביאלק",
    "", "", "", "", "", "",
    18,
    399.84,
    2221.33,
    2621.17,
  ];
  const currentRow = [...legacyRow.slice(0, 4), 20003, ...legacyRow.slice(4)];

  it("reads the amount column, not מע\"מ, in the current layout", () => {
    const result = parseDageiHakibbutzimFile(
      buildFile(CURRENT_HEADERS, [currentRow]),
      0.18
    );

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].franchiseeId).toBe("515289262");
    expect(result.data[0].franchisee).toBe("קריון ביאלק");
    expect(result.data[0].netAmount).toBe(2221);
  });

  it("still parses the legacy layout identically", () => {
    const result = parseDageiHakibbutzimFile(
      buildFile(LEGACY_HEADERS, [legacyRow]),
      0.18
    );

    expect(result.data[0].franchiseeId).toBe("515289262");
    expect(result.data[0].netAmount).toBe(2221);
  });

  it("fails loudly when the amount column disappears", () => {
    const headers = CURRENT_HEADERS.map((h) =>
      h === 'סכום לפני מע"מ' ? "משהו אחר" : h
    );
    const result = parseDageiHakibbutzimFile(buildFile(headers, [currentRow]), 0.18);

    expect(result.success).toBe(false);
    expect(result.legacyErrors.join(" ")).toContain("סכום לפני");
  });
});
