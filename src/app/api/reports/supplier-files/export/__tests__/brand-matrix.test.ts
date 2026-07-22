import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { createBrandMatrixSheets } from "../brand-matrix";
import type { SupplierFilesReport } from "@/data-access/supplier-file-reports";

function fr(
  franchiseeId: string,
  franchiseeName: string,
  brandName: string,
  netAmount: number,
  commission: number
) {
  return {
    franchiseeId,
    franchiseeName,
    brandId: `brand-${brandName}`,
    brandName,
    grossAmount: netAmount * 1.18,
    netAmount,
    commission,
  };
}

const report = {
  summary: {} as SupplierFilesReport["summary"],
  bySupplier: [
    {
      supplierId: "s1",
      supplierName: "אראל",
      supplierCode: "EREL",
      fileCount: 1,
      totalGrossAmount: 0,
      totalNetAmount: 3000,
      totalCommission: 300,
      franchisees: [
        fr("f1", "חיפה", "ויני", 1000, 100),
        fr("f2", "חדרה", "ויני", 2000, 200),
        fr("f3", "תל אביב", "קינג קונג", 500, 50),
      ],
    },
    {
      supplierId: "s2",
      supplierName: "טמפו",
      supplierCode: "TEMPO",
      fileCount: 1,
      totalGrossAmount: 0,
      totalNetAmount: 400,
      totalCommission: 40,
      franchisees: [fr("f1", "חיפה", "ויני", 400, 40)],
    },
  ],
  files: [
    {
      supplierId: "s1",
      commissionRate: 10,
      commissionType: "percentage",
    },
    {
      supplierId: "s2",
      commissionRate: null,
      commissionType: null,
    },
  ] as SupplierFilesReport["files"],
} as SupplierFilesReport;

describe("createBrandMatrixSheets", () => {
  const wb = XLSX.utils.book_new();
  createBrandMatrixSheets(report, wb);

  it("creates one sheet per brand", () => {
    expect(wb.SheetNames).toEqual(["ויני", "קינג קונג"]);
  });

  it("builds the supplier×franchisee matrix with totals", () => {
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(
      wb.Sheets["ויני"],
      { header: 1, defval: "" }
    );
    // Franchisees sorted by Hebrew name: חדרה before חיפה
    expect(rows[1]).toEqual(["ספק", "%", "קניות", "עמלה", "קניות", "עמלה", "סה״כ קניות", "סה״כ עמלות"]);
    expect(rows[0][2]).toBe("חדרה");
    expect(rows[0][4]).toBe("חיפה");
    // אראל: 10% rate, both branches, row totals
    expect(rows[2]).toEqual(["אראל", 0.1, 2000, 200, 1000, 100, 3000, 300]);
    // טמפו: no percentage rate → blank, only חיפה
    expect(rows[3]).toEqual(["טמפו", "", "", "", 400, 40, 400, 40]);
    // Bottom totals row
    expect(rows[4]).toEqual(["סה״כ", "", 2000, 200, 1400, 140, 3400, 340]);
  });

  it("keeps other-brand data out and separate", () => {
    const kk = XLSX.utils.sheet_to_json<(string | number)[]>(
      wb.Sheets["קינג קונג"],
      { header: 1, defval: "" }
    );
    expect(kk[2]).toEqual(["אראל", 0.1, 500, 50, 500, 50]);
    expect(kk[3]).toEqual(["סה״כ", "", 500, 50, 500, 50]);
  });
});
