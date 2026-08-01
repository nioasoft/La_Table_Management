import * as XLSX from "xlsx";

import type {
  CollectionReportRow,
  DiscountReportRow,
  FranchiseeBillingReportPayload,
  RoyaltyReportRow,
  TurnoverReportRow,
} from "@/schemas/franchisee-billing-reports";

// Display format only — Excel keeps the full stored value in the cell, so
// nothing is lost by showing agorot to whoever opens the report.
const MONEY_FORMAT = "#,##0.00";
const RATE_FORMAT = "0.00";

interface ExportTable {
  readonly sheetName: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
  readonly moneyColumns: readonly number[];
  readonly rateColumns: readonly number[];
  readonly columnWidths: readonly number[];
}

function exactNumber(value: string): number {
  return Number(value);
}

function royaltyTable(rows: readonly RoyaltyReportRow[]): ExportTable {
  return {
    sheetName: "תמלוגים",
    headers: [
      "זכיין", "מותג", "תמלוגים", "תעריף הסכם",
      "תעריף בפועל", "ערך הנחה", "סטטוס",
    ],
    rows: rows.map((row) => [
      row.franchiseeName,
      row.brandName,
      exactNumber(row.royalty),
      exactNumber(row.tierRate),
      exactNumber(row.effectiveRate),
      exactNumber(row.discountValue),
      row.status === "approved" ? "מאושר" : "טיוטה",
    ]),
    moneyColumns: [2, 5],
    rateColumns: [3, 4],
    columnWidths: [28, 18, 18, 16, 16, 18, 12],
  };
}

function turnoverTable(rows: readonly TurnoverReportRow[]): ExportTable {
  return {
    sheetName: "מחזורים",
    headers: ["זכיין", "מותג", "מחזור כולל מע״מ", "מחזור לפני מע״מ", "סטטוס"],
    rows: rows.map((row) => [
      row.franchiseeName,
      row.brandName,
      exactNumber(row.grossBase),
      exactNumber(row.netBase),
      row.status === "approved" ? "מאושר" : "טיוטה",
    ]),
    moneyColumns: [2, 3],
    rateColumns: [],
    columnWidths: [28, 18, 22, 22, 12],
  };
}

function collectionTable(rows: readonly CollectionReportRow[]): ExportTable {
  return {
    sheetName: "גבייה",
    headers: ["זכיין", "מותג", "תמלוגים שנגבו", "שיווק שנגבה"],
    rows: rows.map((row) => [
      row.franchiseeName,
      row.brandName,
      exactNumber(row.royaltyCollected),
      exactNumber(row.marketingCollected),
    ]),
    moneyColumns: [2, 3],
    rateColumns: [],
    columnWidths: [28, 18, 22, 22],
  };
}

function discountTable(rows: readonly DiscountReportRow[]): ExportTable {
  return {
    sheetName: "ערך הנחות",
    headers: ["זכיין", "מותג", "ערך הנחות מצטבר"],
    rows: rows.map((row) => [
      row.franchiseeName,
      row.brandName,
      exactNumber(row.discountValue),
    ]),
    moneyColumns: [2],
    rateColumns: [],
    columnWidths: [28, 18, 24],
  };
}

function exportTable(report: FranchiseeBillingReportPayload): ExportTable {
  if (report.reportType === "royalties") return royaltyTable(report.rows);
  if (report.reportType === "turnover") return turnoverTable(report.rows);
  if (report.reportType === "collection") return collectionTable(report.rows);
  return discountTable(report.rows);
}

function applyNumberFormat(
  worksheet: XLSX.WorkSheet,
  rowCount: number,
  columns: readonly number[],
  format: string,
): void {
  for (let row = 1; row <= rowCount; row += 1) {
    for (const column of columns) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell) cell.z = format;
    }
  }
}

export function buildFranchiseeBillingReportWorkbook(
  report: FranchiseeBillingReportPayload,
): Buffer {
  const table = exportTable(report);
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...table.headers],
    ...table.rows.map((row) => [...row]),
  ]);
  worksheet["!cols"] = table.columnWidths.map((width) => ({ wch: width }));
  worksheet["!autofilter"] = { ref: worksheet["!ref"] ?? "A1:A1" };
  applyNumberFormat(
    worksheet,
    table.rows.length,
    table.moneyColumns,
    MONEY_FORMAT,
  );
  applyNumberFormat(
    worksheet,
    table.rows.length,
    table.rateColumns,
    RATE_FORMAT,
  );

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, table.sheetName);
  // SheetJS silently drops worksheet["!dir"]; workbook views persist RTL.
  workbook.Workbook = { Views: [{ RTL: true }] };
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
