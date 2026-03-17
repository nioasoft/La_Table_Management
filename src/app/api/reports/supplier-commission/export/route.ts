import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getSupplierCommissionReport,
  type SupplierCommissionReportFilters,
} from "@/data-access/supplier-commission-report";
import * as XLSX from "xlsx";

/**
 * GET /api/reports/supplier-commission/export - Export supplier commission matrix to Excel
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

    const filters: SupplierCommissionReportFilters = {
      year,
      quarter,
      brandId: searchParams.get("brandId") || undefined,
    };

    const report = await getSupplierCommissionReport(filters);

    if (report.suppliers.length === 0) {
      return NextResponse.json(
        { error: "אין נתונים לייצוא" },
        { status: 400 }
      );
    }

    // Build Excel headers
    const headers = [
      "ספק",
      "קוד ספק",
      "% עמלה",
      "פטור מע״מ",
      ...report.franchisees.map((f) => f.franchiseeName),
      "סה״כ עמלות (לפני מע״מ)",
    ];

    // Format helpers for Excel display
    const fmt = new Intl.NumberFormat("he-IL", {
      maximumFractionDigits: 0,
    });
    const fmtCurrency = (n: number) => `₪ ${fmt.format(Math.round(n))}`;

    // Data rows
    const rows: (string | number)[][] = [];

    for (const sup of report.suppliers) {
      const row: (string | number)[] = [
        sup.isEstimated ? `${sup.supplierName} *` : sup.supplierName,
        sup.supplierCode,
        `${Number(sup.commissionRate).toFixed(1)}%`,
        sup.isVatExempt ? "כן" : "לא",
      ];

      // Add commission amount before VAT for each franchisee
      for (const f of report.franchisees) {
        const cell = sup.cells[f.franchiseeId];
        if (cell) {
          row.push(fmtCurrency(cell.commissionAmountBeforeVat));
        } else {
          row.push("₪ 0");
        }
      }

      // Total commission before VAT
      row.push(fmtCurrency(sup.totalCommissionBeforeVat));

      rows.push(row);
    }

    // Totals row
    const totalsRow: (string | number)[] = ["סה״כ", "", "", ""];

    for (const f of report.franchisees) {
      totalsRow.push(fmtCurrency(f.totalCommissionBeforeVat));
    }

    totalsRow.push(fmtCurrency(report.grandTotals.totalCommissionBeforeVat));

    rows.push(totalsRow);

    // % of turnover row (per franchisee)
    const pctRow: (string | number)[] = ["% ממחזור", "", "", ""];

    for (const f of report.franchisees) {
      const pct =
        f.bkmvRevenue > 0
          ? Math.round(
              (f.totalCommissionBeforeVat / f.bkmvRevenue) * 1000
            ) / 10
          : 0;
      pctRow.push(`${pct.toFixed(1)}%`);
    }

    pctRow.push(
      report.grandTotals.overallPercentOfTurnover != null
        ? `${report.grandTotals.overallPercentOfTurnover.toFixed(1)}%`
        : "0.0%"
    );

    rows.push(pctRow);

    // BKMV revenue row
    const revenueRow: (string | number)[] = ["מחזור (BKMV)", "", "", ""];

    for (const f of report.franchisees) {
      revenueRow.push(fmtCurrency(f.bkmvRevenue));
    }

    revenueRow.push(fmtCurrency(report.grandTotals.totalBkmvRevenue));

    rows.push(revenueRow);

    // Add footnote if any suppliers are estimated (pro-rated)
    if (report.suppliers.some((s) => s.isEstimated)) {
      rows.push([]); // empty separator row
      rows.push([
        "* הערכה רבעונית — סכומים חולקו באופן יחסי עבור ספקים שנתיים/חצי-שנתיים",
      ]);
    }

    // Create workbook
    const wb = XLSX.utils.book_new();
    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    const colWidths = [
      { wch: 25 }, // Supplier name
      { wch: 12 }, // Supplier code
      { wch: 10 }, // Commission rate
      { wch: 10 }, // VAT exempt
    ];

    // Franchisee columns
    for (let i = 0; i < report.franchisees.length; i++) {
      colWidths.push({ wch: 15 });
    }

    // Summary columns
    colWidths.push({ wch: 20 }); // Total commissions

    ws["!cols"] = colWidths;

    // Set RTL direction for Hebrew
    ws["!dir"] = "rtl";

    XLSX.utils.book_append_sheet(wb, ws, "עמלות ספקים");

    // Generate buffer
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // Create filename
    const brandSuffix = report.brandName ? `-${report.brandName}` : "";
    const filename = `supplier-commissions-${year}-Q${quarter}${brandSuffix}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (error) {
    console.error("Error exporting supplier commission report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
