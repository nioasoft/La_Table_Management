import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import {
  buildAnnualReportTable,
  buildFranchiseeBillingAnnualWorkbook,
} from "@/lib/franchisee-billing-annual-export";
import type {
  FranchiseeBillingAnnualPayload,
  FranchiseeBillingAnnualRow,
  FranchiseeBillingAnnualType,
} from "@/schemas/franchisee-billing-annual";

function row(
  overrides: Partial<FranchiseeBillingAnnualRow> = {},
): FranchiseeBillingAnnualRow {
  const months = Array.from({ length: 12 }, () => null) as (string | null)[];
  months[6] = "1000";
  return {
    franchiseeId: "f-1",
    franchiseeName: "סידיוס בע״מ",
    brandName: "פט ויני",
    months,
    total: "1000",
    average: "1000",
    ratePercent: "5",
    turnoverTotal: "20000",
    ...overrides,
  };
}

function report(
  reportType: FranchiseeBillingAnnualType,
  rows: readonly FranchiseeBillingAnnualRow[] = [row()],
): FranchiseeBillingAnnualPayload {
  return { reportType, year: 2026, rows: [...rows] };
}

describe("buildAnnualReportTable", () => {
  it("lays out brand, branch, twelve months, total and average", () => {
    const table = buildAnnualReportTable(report("turnover"));

    expect(table.headers.slice(0, 3)).toEqual(["מותג", "סניף", "ינואר"]);
    expect(table.headers.slice(-3)).toEqual(["דצמבר", "סה״כ שנתי", "ממוצע"]);
    expect(table.headers).toHaveLength(16);
  });

  it("adds the percentage column to the royalty grid only", () => {
    expect(buildAnnualReportTable(report("royalties")).headers).toHaveLength(17);
    expect(buildAnnualReportTable(report("marketing")).headers).toHaveLength(16);
    expect(buildAnnualReportTable(report("royalties")).headers.at(-1)).toBe("%");
  });

  it("names the sheet after the report", () => {
    expect(buildAnnualReportTable(report("turnover")).sheetName).toBe("מחזורים");
    expect(buildAnnualReportTable(report("royalties")).sheetName).toBe("תמלוגים");
    expect(buildAnnualReportTable(report("marketing")).sheetName).toBe("שיווק");
    expect(buildAnnualReportTable(report("discounts")).sheetName).toBe("הנחות");
  });

  it("leaves a month with no billing row blank rather than zero", () => {
    const [first] = buildAnnualReportTable(report("turnover")).rows;

    expect(first[2]).toBe("");
    expect(first[8]).toBe(1000);
  });

  it("writes a subtotal line per brand and one group total at the end", () => {
    const table = buildAnnualReportTable(
      report("turnover", [
        row(),
        row({ franchiseeId: "f-2", franchiseeName: "קינג חורב", brandName: "קינג קונג" }),
      ]),
    );

    expect(table.rows).toHaveLength(5);
    expect(table.rows[1][1]).toBe("סה״כ פט ויני");
    expect(table.rows[3][1]).toBe("סה״כ קינג קונג");
    expect(table.rows.at(-1)?.[1]).toBe("סה״כ קבוצתי");
  });

  it("does not offer a filter, which would strand the subtotal lines", () => {
    expect(buildAnnualReportTable(report("turnover")).autofilter).toBe(false);
  });
});

describe("buildFranchiseeBillingAnnualWorkbook", () => {
  it("writes an RTL workbook", () => {
    const workbook = XLSX.read(
      buildFranchiseeBillingAnnualWorkbook(report("royalties")),
      { type: "buffer" },
    );

    expect(workbook.Workbook?.Views?.[0]?.RTL).toBe(true);
    expect(workbook.SheetNames).toEqual(["תמלוגים"]);
  });

  it("keeps the Hebrew headers and the exact amounts", () => {
    const workbook = XLSX.read(
      buildFranchiseeBillingAnnualWorkbook(report("turnover")),
      { type: "buffer" },
    );
    const sheet = workbook.Sheets["מחזורים"];

    expect(sheet.A1.v).toBe("מותג");
    expect(sheet.B1.v).toBe("סניף");
    expect(sheet.I2.v).toBe(1000);
  });
});
