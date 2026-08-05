import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseRoyaltyRevenueFile } from "../royalty-revenue-parser";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const fixture = (name: string): Buffer =>
  readFileSync(join(__dirname, "fixtures", name));

const workbookBuffer = (rows: unknown[][]): Buffer => {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Export");
  return Buffer.from(XLSX.write(workbook, { bookType: "xlsx", type: "array" }));
};

describe("parseRoyaltyRevenueFile", () => {
  it("parses Vinni year-only rows by their headers and rejects the missing month grouping", () => {
    const result = parseRoyaltyRevenueFile(
      fixture("royalty-revenue-vinni-year-only.xlsx"),
      XLSX_MIME,
    );

    expect(result.success).toBe(false);
    expect(result.errors).toContain(
      "הקובץ מכסה 03/04/2026–02/07/2026 — יותר מחודש אחד. ייצאי מטאבית קובץ של חודש בודד",
    );
    expect(
      result.data?.rows.map(
        ({ branchName, receipts, tips, missingBranchName }) => ({
          branchName,
          receipts,
          tips,
          missingBranchName,
        }),
      ),
    ).toEqual([
      {
        branchName: "VINNI חדרה",
        receipts: 2130664.6,
        tips: 0,
        missingBranchName: false,
      },
      {
        branchName: "VINNI יהוד",
        receipts: 2192380.35,
        tips: 18,
        missingBranchName: false,
      },
      {
        branchName: "VINNI כרמיאל",
        receipts: 2570282.1,
        tips: 0,
        missingBranchName: false,
      },
      {
        branchName: "VINNI נתניה",
        receipts: 2828795.9,
        tips: 0,
        missingBranchName: false,
      },
      {
        branchName: "VINNI עזריאלי חיפה",
        receipts: 2575703.76,
        tips: 133705.37,
        missingBranchName: false,
      },
      {
        branchName: "VINNI קריות",
        receipts: 3228846.96,
        tips: 0,
        missingBranchName: false,
      },
      {
        branchName: "VINNI רגבה",
        receipts: 3241791.35,
        tips: 174438.6,
        missingBranchName: false,
      },
    ]);
    expect(result.data?.rows.every((row) => row.period === null)).toBe(true);
  });

  it("parses Mina year-only rows and removes terminal, total, and filter rows", () => {
    const result = parseRoyaltyRevenueFile(
      fixture("royalty-revenue-mina-year-only.xlsx"),
      XLSX_MIME,
    );

    expect(result.success).toBe(false);
    expect(result.errors).toContain(
      "הקובץ מכסה 03/04/2026–02/07/2026 — יותר מחודש אחד. ייצאי מטאבית קובץ של חודש בודד",
    );
    expect(
      result.data?.rows.map(({ branchName, receipts, tips }) => ({
        branchName,
        receipts,
        tips,
      })),
    ).toEqual([
      { branchName: "מינה טומיי יהוד", receipts: 3509032.2, tips: 0 },
      {
        branchName: "מינה טומיי עין שמר",
        receipts: 5609404,
        tips: 267646.8,
      },
      {
        branchName: "מינה טומיי קסטרא חיפה",
        receipts: 9393613.87,
        tips: 354734.02,
      },
      { branchName: "מינה טומיי קריון", receipts: 4399380.8, tips: 0 },
      { branchName: "מינה טומיי תל אביב", receipts: 2829413.4, tips: 0 },
    ]);
  });

  it("parses King Kong's reversed amount columns and flags its non-zero unnamed row", () => {
    const result = parseRoyaltyRevenueFile(
      fixture("royalty-revenue-king-kong-year-only.xlsx"),
      XLSX_MIME,
    );

    expect(result.success).toBe(false);
    expect(result.errors).toContain(
      "הקובץ מכסה 03/04/2026–02/07/2026 — יותר מחודש אחד. ייצאי מטאבית קובץ של חודש בודד",
    );
    expect(
      result.data?.rows.map(
        ({ branchName, receipts, tips, missingBranchName }) => ({
          branchName,
          receipts,
          tips,
          missingBranchName,
        }),
      ),
    ).toEqual([
      {
        branchName: "",
        receipts: 2694724.05,
        tips: 54574.1,
        missingBranchName: true,
      },
      {
        branchName: "קינג קונג ביג קריית אתא",
        receipts: 4479534.5,
        tips: 155957,
        missingBranchName: false,
      },
      {
        branchName: "קינג קונג חדרה",
        receipts: 2694960.41,
        tips: 108279,
        missingBranchName: false,
      },
      {
        branchName: "קינג קונג חיפה",
        receipts: 3983099.7,
        tips: 106739.8,
        missingBranchName: false,
      },
      {
        branchName: "קינג קונג כרמיאל",
        receipts: 2833290.2,
        tips: 0,
        missingBranchName: false,
      },
      {
        branchName: "קינג קונג נהריה",
        receipts: 3238034.4,
        tips: 0,
        missingBranchName: false,
      },
      {
        branchName: "קינג קונג עפולה",
        receipts: 1395389.44,
        tips: 56818,
        missingBranchName: false,
      },
      {
        branchName: "קינג קונג קריית מוצקין",
        receipts: 92717.2,
        tips: 0,
        missingBranchName: false,
      },
      {
        branchName: "קינג קונג רעננה",
        receipts: 4490977.25,
        tips: 0,
        missingBranchName: false,
      },
    ]);
  });

  it("reads a period from every row when all columns are reordered", () => {
    const buffer = workbookBuffer([
      ["כותרת עליונה"],
      ['סה"כ תקבולים', "תקופה", 'סה"כ טיפ', "סניף"],
      [1234.56789123, "2026 יולי", 12.34567891, "סניף א"],
      [0, "אוגוסט 2026", 0, "מותג - סניף מסוף רישתי"],
      [2, "אוגוסט 2026", 1, "Total"],
      [999.123456789, "אוגוסט 2026", 9.987654321, ""],
      ["", "", "", "מסננים שהוחלו: fromDate"],
    ]);

    const result = parseRoyaltyRevenueFile(buffer, XLSX_MIME);

    expect(result).toEqual({
      success: true,
      data: {
        rows: [
          {
            branchName: "סניף א",
            receipts: 1234.56789123,
            tips: 12.34567891,
            period: { month: 7, year: 2026 },
            missingBranchName: false,
            missingReceipts: false,
            missingTips: false,
          },
          {
            branchName: "",
            receipts: 999.123456789,
            tips: 9.987654321,
            period: { month: 8, year: 2026 },
            missingBranchName: true,
            missingReceipts: false,
            missingTips: false,
          },
        ],
      },
      errors: [],
      warnings: [],
    });
  });

  it("returns parsed data with an explicit error when a row has no month", () => {
    const buffer = workbookBuffer([
      ["כותרת עליונה"],
      ["סניף", 'סה"כ טיפ', "שנה וחודש", 'סה"כ תקבולים'],
      ["סניף א", 12, "2026 יולי", 1200],
      ["סניף ב", 15, "", 1500],
    ]);

    const result = parseRoyaltyRevenueFile(buffer, XLSX_MIME);

    expect(result.success).toBe(false);
    expect(result.data?.rows).toHaveLength(2);
    expect(result.data?.rows[1].period).toBeNull();
    expect(result.errors.join(" ")).toContain("לא ניתן לזהות חודש בשורה 4");
  });

  it("flags an empty receipts cell without converting it to zero", () => {
    const buffer = workbookBuffer([
      ["סניף", 'סה"כ טיפ', "שנה וחודש", 'סה"כ תקבולים'],
      ["סניף א", 25, "2026 יולי", ""],
    ]);

    const result = parseRoyaltyRevenueFile(buffer, XLSX_MIME);
    const row = result.data?.rows[0];

    expect(result.success).toBe(true);
    expect(row?.receipts).toBeNull();
    expect(row?.tips).toBe(25);
    expect(row?.missingReceipts).toBe(true);
    expect(row?.missingTips).toBe(false);
  });

  it("flags an empty tips cell without converting it to zero", () => {
    const buffer = workbookBuffer([
      ["סניף", 'סה"כ טיפ', "שנה וחודש", 'סה"כ תקבולים'],
      ["סניף א", "", "2026 יולי", 2500],
    ]);

    const result = parseRoyaltyRevenueFile(buffer, XLSX_MIME);
    const row = result.data?.rows[0];

    expect(result.success).toBe(true);
    expect(row?.receipts).toBe(2500);
    expect(row?.tips).toBeNull();
    expect(row?.missingReceipts).toBe(false);
    expect(row?.missingTips).toBe(true);
  });

  it("takes the month from the applied-filters footer when the export is grouped by year", () => {
    const buffer = workbookBuffer([
      ["שנה", 2026, 2026],
      ["סניף", 'סה"כ תקבולים', 'סה"כ טיפ'],
      ["סניף א", 1200, 12],
      ["סניף ב", 1500, 15],
      [
        "מסננים שהוחלו:\r\nfromDate הוא 2026-07-01\r\ntoDate הוא 2026-07-31\r\n_id בשעה 01/07/2026 00:00:00 או אחריה",
      ],
    ]);

    const result = parseRoyaltyRevenueFile(buffer, XLSX_MIME);

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.data?.rows.map((row) => row.period)).toEqual([
      { year: 2026, month: 7 },
      { year: 2026, month: 7 },
    ]);
  });

  it("treats a first-of-next-month end date as the same single month", () => {
    const buffer = workbookBuffer([
      ["שנה", 2026, 2026],
      ["סניף", 'סה"כ תקבולים', 'סה"כ טיפ'],
      ["סניף א", 1200, 12],
      ["מסננים שהוחלו:\r\nfromDate הוא 2026-07-01\r\ntoDate הוא 2026-08-01"],
    ]);

    const result = parseRoyaltyRevenueFile(buffer, XLSX_MIME);

    expect(result.success).toBe(true);
    expect(result.data?.rows[0].period).toEqual({ year: 2026, month: 7 });
  });

  it("blocks a footer range that spans more than one month", () => {
    const buffer = workbookBuffer([
      ["שנה", 2026, 2026],
      ["סניף", 'סה"כ תקבולים', 'סה"כ טיפ'],
      ["סניף א", 1200, 12],
      ["מסננים שהוחלו:\r\nfromDate הוא 2026-04-03\r\ntoDate הוא 2026-07-02"],
    ]);

    const result = parseRoyaltyRevenueFile(buffer, XLSX_MIME);

    expect(result.success).toBe(false);
    expect(result.errors).toContain(
      "הקובץ מכסה 03/04/2026–02/07/2026 — יותר מחודש אחד. ייצאי מטאבית קובץ של חודש בודד",
    );
    expect(result.data?.rows[0].period).toBeNull();
  });

  it("keeps the missing-month error when the export has no footer at all", () => {
    const buffer = workbookBuffer([
      ["שנה", 2026, 2026],
      ["סניף", 'סה"כ תקבולים', 'סה"כ טיפ'],
      ["סניף א", 1200, 12],
    ]);

    const result = parseRoyaltyRevenueFile(buffer, XLSX_MIME);

    expect(result.success).toBe(false);
    expect(result.errors).toContain("הקובץ אינו מקובץ לפי חודש");
  });

  it("names the missing branch grouping when the export is grouped by month", () => {
    const buffer = workbookBuffer([
      ["שנה", 2026, 2026],
      ["חודש בשנה", 'סה"כ תקבולים', 'סה"כ טיפ'],
      ["יולי", 347897.2, 0],
      ["Total", 347897.2, 0],
      ["מסננים שהוחלו:\r\nfromDate הוא 2026-07-01\r\ntoDate הוא 2026-07-31"],
    ]);

    const result = parseRoyaltyRevenueFile(buffer, XLSX_MIME);

    expect(result.success).toBe(false);
    expect(result.errors).toEqual([
      "הקובץ אינו מקובץ לפי סניף — ייצאי מטאבית בקיבוץ לפי סניף",
    ]);
  });

  it("keeps the generic header error when no known column is present", () => {
    const buffer = workbookBuffer([["כותרת עליונה"], ["בלי כלום"]]);

    const result = parseRoyaltyRevenueFile(buffer, XLSX_MIME);

    expect(result.errors).toEqual([
      'לא נמצאו כותרות "סניף", "סה״כ תקבולים" ו"סה״כ טיפ"',
    ]);
  });

  it("keeps explicit zero amounts valid and unflagged", () => {
    const buffer = workbookBuffer([
      ["סניף", 'סה"כ טיפ', "שנה וחודש", 'סה"כ תקבולים'],
      ["סניף א", 0, "2026 יולי", 0],
    ]);

    const result = parseRoyaltyRevenueFile(buffer, XLSX_MIME);
    const row = result.data?.rows[0];

    expect(result.success).toBe(true);
    expect(row?.receipts).toBe(0);
    expect(row?.tips).toBe(0);
    expect(row?.missingReceipts).toBe(false);
    expect(row?.missingTips).toBe(false);
  });
});
