import {
  groupAnnualRows,
  type AnnualGrouping,
} from "@/lib/franchisee-billing-annual-summary";
import {
  buildWorkbook,
  type ExportTable,
} from "@/lib/franchisee-billing-report-export";
import type {
  FranchiseeBillingAnnualPayload,
  FranchiseeBillingAnnualRow,
  FranchiseeBillingAnnualType,
} from "@/schemas/franchisee-billing-annual";

export const ANNUAL_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
] as const;

/** Reut reads these grids in shekels; the cell keeps the exact stored value. */
const GRID_MONEY_FORMAT = "#,##0";

export const ANNUAL_SHEET_NAMES: Record<FranchiseeBillingAnnualType, string> = {
  turnover: "מחזורים",
  royalties: "תמלוגים",
  marketing: "שיווק",
  discounts: "הנחות",
};

type Cell = string | number;

/** An empty month stays empty — a blank cell is not a billed ₪0. */
function cell(value: string | null): Cell {
  return value === null ? "" : Number(value);
}

function tableRow(
  row: FranchiseeBillingAnnualRow,
  brandLabel: string,
  withRate: boolean,
): Cell[] {
  const cells: Cell[] = [
    brandLabel,
    row.franchiseeName,
    ...row.months.map(cell),
    cell(row.total),
    cell(row.average),
  ];
  if (withRate) cells.push(cell(row.ratePercent));
  return cells;
}

function tableRows(
  grouping: AnnualGrouping,
  withRate: boolean,
): Cell[][] {
  const rows: Cell[][] = [];
  for (const brand of grouping.brands) {
    for (const row of brand.rows) {
      rows.push(tableRow(row, brand.brandName, withRate));
    }
    rows.push(tableRow(brand.subtotal, brand.brandName, withRate));
  }
  rows.push(tableRow(grouping.grandTotal, "", withRate));
  return rows;
}

export function buildAnnualReportTable(
  report: FranchiseeBillingAnnualPayload,
): ExportTable {
  const withRate = report.reportType === "royalties";
  const headers = [
    "מותג",
    "סניף",
    ...ANNUAL_MONTHS,
    "סה״כ שנתי",
    "ממוצע",
    ...(withRate ? ["%"] : []),
  ];
  // Columns 2..15 are the months, then the year total and the average.
  const moneyColumns = Array.from({ length: 14 }, (_, index) => index + 2);
  return {
    sheetName: ANNUAL_SHEET_NAMES[report.reportType],
    headers,
    rows: tableRows(groupAnnualRows(report.rows), withRate),
    moneyColumns,
    rateColumns: withRate ? [16] : [],
    columnWidths: [
      16, 28,
      ...ANNUAL_MONTHS.map(() => 13),
      15, 13,
      ...(withRate ? [8] : []),
    ],
    moneyFormat: GRID_MONEY_FORMAT,
    // Subtotal lines sit between the branches; a filter would strand them.
    autofilter: false,
  };
}

export function buildFranchiseeBillingAnnualWorkbook(
  report: FranchiseeBillingAnnualPayload,
): Buffer {
  return buildWorkbook(buildAnnualReportTable(report));
}
