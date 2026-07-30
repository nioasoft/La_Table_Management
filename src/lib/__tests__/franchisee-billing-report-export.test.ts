import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { buildFranchiseeBillingReportWorkbook } from "@/lib/franchisee-billing-report-export";
import type { FranchiseeBillingReportPayload } from "@/schemas/franchisee-billing-reports";

const period = { year: 2026, month: 6 } as const;

const royaltyReport: FranchiseeBillingReportPayload = {
  reportType: "royalties",
  period,
  rows: [
    {
      franchiseeId: "franchisee-1",
      franchiseeName: "ויני חדרה",
      brandName: "פט ויני",
      royalty: "123.456789",
      tierRate: "5.00",
      effectiveRate: "4.00",
      discountValue: "31.123456",
      status: "approved",
    },
  ],
};

const turnoverReport: FranchiseeBillingReportPayload = {
  reportType: "turnover",
  period,
  rows: [
    {
      franchiseeId: "franchisee-2",
      franchiseeName: "נתנזון",
      brandName: "לה טבלה",
      grossBase: "1234.567891",
      netBase: "1055.194779",
      status: "draft",
    },
  ],
};

const collectionReport: FranchiseeBillingReportPayload = {
  reportType: "collection",
  period,
  rows: [
    {
      franchiseeId: "franchisee-3",
      franchiseeName: "סניף השרון",
      brandName: "פט ויני",
      royaltyCollected: "300.123456",
      marketingCollected: "45.654321",
    },
  ],
};

const discountReport: FranchiseeBillingReportPayload = {
  reportType: "discounts",
  period,
  rows: [
    {
      franchiseeId: "franchisee-4",
      franchiseeName: "סניף הדרום",
      brandName: "לה טבלה",
      discountValue: "31.123456",
    },
  ],
};

interface ExportCase {
  readonly name: string;
  readonly report: FranchiseeBillingReportPayload;
  readonly sheetName: string;
  readonly expectedRows: readonly (readonly (string | number)[])[];
  readonly autoFilter: string;
}

const exportCases: readonly ExportCase[] = [
  {
    name: "תמלוגים",
    report: royaltyReport,
    sheetName: "תמלוגים",
    expectedRows: [
      [
        "זכיין",
        "מותג",
        "תמלוגים",
        "תעריף הסכם",
        "תעריף בפועל",
        "ערך הנחה",
        "סטטוס",
      ],
      ["ויני חדרה", "פט ויני", 123.456789, 5, 4, 31.123456, "מאושר"],
    ],
    autoFilter: "A1:G2",
  },
  {
    name: "מחזורים",
    report: turnoverReport,
    sheetName: "מחזורים",
    expectedRows: [
      ["זכיין", "מותג", "מחזור כולל מע״מ", "מחזור לפני מע״מ", "סטטוס"],
      ["נתנזון", "לה טבלה", 1234.567891, 1055.194779, "טיוטה"],
    ],
    autoFilter: "A1:E2",
  },
  {
    name: "גבייה",
    report: collectionReport,
    sheetName: "גבייה",
    expectedRows: [
      ["זכיין", "מותג", "תמלוגים שנגבו", "שיווק שנגבה"],
      ["סניף השרון", "פט ויני", 300.123456, 45.654321],
    ],
    autoFilter: "A1:D2",
  },
  {
    name: "ערך הנחות",
    report: discountReport,
    sheetName: "ערך הנחות",
    expectedRows: [
      ["זכיין", "מותג", "ערך הנחות מצטבר"],
      ["סניף הדרום", "לה טבלה", 31.123456],
    ],
    autoFilter: "A1:C2",
  },
];

describe("franchisee billing report Excel export", () => {
  it.each(exportCases)(
    "round-trips $name headers, column order, values, and RTL",
    ({ report, sheetName, expectedRows, autoFilter }) => {
      const buffer = buildFranchiseeBillingReportWorkbook(report);
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const worksheet = workbook.Sheets[sheetName];

      expect(workbook.SheetNames).toEqual([sheetName]);
      expect(workbook.Workbook?.Views?.[0]?.RTL).toBe(true);
      expect(worksheet).toBeDefined();
      expect(
        XLSX.utils.sheet_to_json<(string | number)[]>(worksheet, {
          header: 1,
          raw: true,
        }),
      ).toEqual(expectedRows);
      expect(worksheet["!autofilter"]?.ref).toBe(autoFilter);
    },
  );
});
