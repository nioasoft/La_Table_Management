import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { pickSheetForPeriod } from "../sheet-period";
import { processSupplierFile } from "../file-processor";
import type { SupplierFileMapping } from "@/db/schema";

const Q3 = { start: "2026-07-01", end: "2026-09-30" };

/** A quarterly tab laid out like רסטרטו's report: title row, header, Totals, branches. */
function quarterTab(quarter: string, amounts: [string, number][]): XLSX.WorkSheet {
  const total = amounts.reduce((s, [, a]) => s + a, 0);
  return XLSX.utils.aoa_to_sheet([
    [],
    [],
    [],
    ["", "", `מכירות ${quarter} 2026`],
    ["לקוח מרכז", "שם לקוח", 'סה"כ'],
    ["קבוצה*", "Totals", total],
    ...amounts.map(([name, amount]) => ["", name, amount]),
  ]);
}

function book(tabs: [string, XLSX.WorkSheet][]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, ws] of tabs) XLSX.utils.book_append_sheet(wb, ws, name);
  return wb;
}

// רסטרטו Q3-2026: the supplier added the Q3 tab next to last quarter's, and the
// configured sheet "פט ויני" matched neither — the first (Q2) tab was read.
const ristrettoQ3 = book([
  ["פט ויני + דון פדרו Q2", quarterTab("Q2", [["סניף א", 78704], ["סניף ב", 70289]])],
  ["פט ויני + דון פדרו Q3", quarterTab("Q3", [["סניף א", 99964], ["סניף ב", 104341]])],
]);

describe("pickSheetForPeriod", () => {
  it("picks the tab labeled with the chosen quarter", () => {
    const pick = pickSheetForPeriod(ristrettoQ3, "פט ויני", Q3);
    expect(pick).toMatchObject({ sheetName: "פט ויני + דון פדרו Q3" });
  });

  it("blocks when no tab is labeled with the chosen quarter", () => {
    const pick = pickSheetForPeriod(ristrettoQ3, "פט ויני", { start: "2026-10-01", end: "2026-12-31" });
    expect(pick).toHaveProperty("errorHe");
  });

  it("blocks when period-labeled tabs exist but no period was given", () => {
    expect(pickSheetForPeriod(ristrettoQ3, "פט ויני", undefined)).toHaveProperty("errorHe");
  });

  it("reads רבעון labels and checks the year", () => {
    const wb = book([
      ["רבעון 3 2025", XLSX.utils.aoa_to_sheet([["א", 1]])],
      ["רבעון 3 2026", XLSX.utils.aoa_to_sheet([["א", 2]])],
    ]);
    expect(pickSheetForPeriod(wb, undefined, Q3)).toMatchObject({ sheetName: "רבעון 3 2026" });
  });

  it("keeps the configured sheet when it exists", () => {
    const wb = book([["אחר", XLSX.utils.aoa_to_sheet([["x"]])], ["עמלה", XLSX.utils.aoa_to_sheet([["y"]])]]);
    expect(pickSheetForPeriod(wb, "עמלה", Q3)).toEqual({ sheetName: "עמלה" });
  });

  it("keeps a single-sheet file as is", () => {
    const wb = book([["פט ויני + דון פדרו (2)", quarterTab("Q2", [["א", 1]])]]);
    expect(pickSheetForPeriod(wb, "פט ויני", Q3)).toEqual({ sheetName: "פט ויני + דון פדרו (2)" });
  });

  it("keeps the first sheet of an unlabeled multi-tab file with no configured sheet", () => {
    const wb = book([["עמלה", XLSX.utils.aoa_to_sheet([["x"]])], ["פריטים מוחרגים", XLSX.utils.aoa_to_sheet([["y"]])]]);
    expect(pickSheetForPeriod(wb, undefined, Q3)).toEqual({ sheetName: "עמלה" });
  });

  it("blocks when the configured sheet is missing among unlabeled tabs", () => {
    const wb = book([["גיליון1", XLSX.utils.aoa_to_sheet([["x"]])], ["גיליון2", XLSX.utils.aoa_to_sheet([["y"]])]]);
    expect(pickSheetForPeriod(wb, "עמלה", Q3)).toHaveProperty("errorHe");
  });
});

describe("processSupplierFile — multi-tab generic file", () => {
  const mapping: SupplierFileMapping = {
    fileType: "xlsx",
    headerRow: 2,
    dataStartRow: 3,
    sheetName: "פט ויני",
    skipKeywords: ['סה"כ'],
    columnMappings: { franchiseeColumn: "B", amountColumn: "C", dateColumn: "" },
  };
  const buffer = Buffer.from(XLSX.write(ristrettoQ3, { type: "buffer", bookType: "xlsx" }));

  it("reads the chosen period's tab and says which tab it read", async () => {
    const result = await processSupplierFile(buffer, mapping, false, 0.18, "RISTRETTO", false, undefined, "x.xlsx", { period: Q3 });
    const amounts = result.data.filter((r) => r.franchisee !== "Totals").map((r) => r.netAmount);
    expect(amounts).toEqual([99964, 104341]);
    expect(result.anomalies?.find((a) => a.code === "SHEET_CHOSEN_BY_PERIOD")?.messageHe).toContain("Q3");
  });

  it("refuses the file instead of guessing when the period has no tab", async () => {
    const result = await processSupplierFile(buffer, mapping, false, 0.18, "RISTRETTO", false, undefined, "x.xlsx", {
      period: { start: "2026-10-01", end: "2026-12-31" },
    });
    expect(result.success).toBe(false);
    expect(result.data).toEqual([]);
    expect(result.anomalies?.map((a) => [a.code, a.severity])).toEqual([["SHEET_PERIOD_AMBIGUOUS", "blocking"]]);
  });
});
