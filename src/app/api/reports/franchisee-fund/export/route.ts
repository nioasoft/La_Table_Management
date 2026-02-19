import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getFranchiseeFundReport,
  type FranchiseeFundReportFilters,
} from "@/data-access/franchisee-fund-report";
import * as XLSX from "xlsx";

/**
 * GET /api/reports/franchisee-fund/export - Export franchisee fund report to Excel
 *
 * Query parameters:
 * - year: number (required)
 * - quarter: 1|2|3|4 (required)
 * - brandId: string (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;

    // Validate required parameters
    const yearStr = searchParams.get("year");
    const quarterStr = searchParams.get("quarter");

    if (!yearStr || !quarterStr) {
      return NextResponse.json(
        { error: "year and quarter are required" },
        { status: 400 }
      );
    }

    const year = parseInt(yearStr, 10);
    const quarter = parseInt(quarterStr, 10) as 1 | 2 | 3 | 4;

    if (isNaN(year) || year < 2020 || year > 2100) {
      return NextResponse.json(
        { error: "Invalid year" },
        { status: 400 }
      );
    }

    if (![1, 2, 3, 4].includes(quarter)) {
      return NextResponse.json(
        { error: "Quarter must be 1, 2, 3, or 4" },
        { status: 400 }
      );
    }

    const filters: FranchiseeFundReportFilters = {
      year,
      quarter,
      brandId: searchParams.get("brandId") || undefined,
    };

    const report = await getFranchiseeFundReport(filters);

    if (report.suppliers.length === 0) {
      return NextResponse.json(
        { error: "אין נתונים לייצוא" },
        { status: 400 }
      );
    }

    // Build the Excel data
    // First row: headers with franchisee names
    const headers = [
      "ספק",
      "קוד ספק",
      "% עמלה כוללת",
      "% קרן",
      "פטור מע״מ",
      ...report.franchisees.flatMap((f) => [
        `${f.franchiseeName} - עמלה כולל מע״מ`,
        `${f.franchiseeName} - קרן כולל מע״מ`,
        `${f.franchiseeName} - עמלה לפני מע״מ`,
        `${f.franchiseeName} - קרן לפני מע״מ`,
      ]),
      "סה״כ עמלה כולל מע״מ",
      "סה״כ קרן כולל מע״מ",
      "סה״כ עמלה לפני מע״מ",
      "סה״כ קרן לפני מע״מ",
    ];

    // Data rows
    const rows: (string | number)[][] = [];

    for (const supplier of report.suppliers) {
      const row: (string | number)[] = [
        supplier.supplierName,
        supplier.supplierCode,
        supplier.totalCommissionRate,
        supplier.fundRate,
        supplier.isVatExempt ? "כן" : "לא",
      ];

      // Add data for each franchisee
      for (const f of report.franchisees) {
        const cell = supplier.cells[f.franchiseeId];
        if (cell) {
          row.push(Math.round(cell.totalCommission * 100) / 100);
          row.push(Math.round(cell.fundAmount * 100) / 100);
          row.push(Math.round(cell.totalCommissionBeforeVat * 100) / 100);
          row.push(Math.round(cell.fundAmountBeforeVat * 100) / 100);
        } else {
          row.push(0);
          row.push(0);
          row.push(0);
          row.push(0);
        }
      }

      // Add totals
      row.push(Math.round(supplier.totals.totalCommission * 100) / 100);
      row.push(Math.round(supplier.totals.fundAmount * 100) / 100);
      row.push(Math.round(supplier.totals.totalCommissionBeforeVat * 100) / 100);
      row.push(Math.round(supplier.totals.fundAmountBeforeVat * 100) / 100);

      rows.push(row);
    }

    // Add totals row
    const totalsRow: (string | number)[] = [
      "סה״כ",
      "",
      "",
      "",
      "",
    ];

    for (const f of report.franchisees) {
      totalsRow.push(Math.round(f.totalCommissions * 100) / 100);
      totalsRow.push(Math.round(f.totalFund * 100) / 100);
      totalsRow.push(Math.round(f.totalCommissionsBeforeVat * 100) / 100);
      totalsRow.push(Math.round(f.totalFundBeforeVat * 100) / 100);
    }

    totalsRow.push(Math.round(report.grandTotals.totalCommissions * 100) / 100);
    totalsRow.push(Math.round(report.grandTotals.totalFund * 100) / 100);
    totalsRow.push(Math.round(report.grandTotals.totalCommissionsBeforeVat * 100) / 100);
    totalsRow.push(Math.round(report.grandTotals.totalFundBeforeVat * 100) / 100);

    rows.push(totalsRow);

    // Create workbook
    const wb = XLSX.utils.book_new();
    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    const colWidths = [
      { wch: 25 }, // Supplier name
      { wch: 12 }, // Supplier code
      { wch: 12 }, // Total commission rate
      { wch: 8 },  // Fund rate
      { wch: 10 }, // VAT exempt
    ];

    // Add widths for franchisee columns (4 per franchisee)
    for (let i = 0; i < report.franchisees.length; i++) {
      colWidths.push({ wch: 15 }); // Commission incl. VAT
      colWidths.push({ wch: 12 }); // Fund incl. VAT
      colWidths.push({ wch: 15 }); // Commission before VAT
      colWidths.push({ wch: 12 }); // Fund before VAT
    }

    // Totals columns
    colWidths.push({ wch: 15 }); // Total commission incl. VAT
    colWidths.push({ wch: 12 }); // Total fund incl. VAT
    colWidths.push({ wch: 15 }); // Total commission before VAT
    colWidths.push({ wch: 12 }); // Total fund before VAT

    ws["!cols"] = colWidths;

    // Set RTL direction for Hebrew
    ws["!dir"] = "rtl";

    XLSX.utils.book_append_sheet(wb, ws, "קרן זכיינים");

    // Generate buffer
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // Create filename
    const brandSuffix = report.brandName ? `-${report.brandName}` : "";
    const filename = `franchisee-fund-${year}-Q${quarter}${brandSuffix}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (error) {
    console.error("Error exporting franchisee fund report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
