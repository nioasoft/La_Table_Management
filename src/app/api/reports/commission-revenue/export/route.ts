import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getCommissionRevenueReport,
  type CommissionRevenueReportFilters,
} from "@/data-access/commission-revenue-report";
import * as XLSX from "xlsx";

/**
 * GET /api/reports/commission-revenue/export - Export commission-to-revenue report to Excel
 *
 * Query parameters:
 * - year: number (required)
 * - quarter: 1|2|3|4|annual (required)
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
    if (isNaN(year) || year < 2020 || year > 2100) {
      return NextResponse.json(
        { error: "Invalid year" },
        { status: 400 }
      );
    }

    let quarter: 1 | 2 | 3 | 4 | "annual";
    if (quarterStr === "annual") {
      quarter = "annual";
    } else {
      const q = parseInt(quarterStr, 10);
      if (![1, 2, 3, 4].includes(q)) {
        return NextResponse.json(
          { error: "Quarter must be 1, 2, 3, 4, or 'annual'" },
          { status: 400 }
        );
      }
      quarter = q as 1 | 2 | 3 | 4;
    }

    const filters: CommissionRevenueReportFilters = {
      year,
      quarter,
      brandId: searchParams.get("brandId") || undefined,
    };

    const report = await getCommissionRevenueReport(filters);

    if (report.rows.length === 0) {
      return NextResponse.json(
        { error: "אין נתונים לייצוא" },
        { status: 400 }
      );
    }

    // Build Excel data
    const headers = [
      "שם זכיין",
      "קוד",
      "מותג",
      "מחזור (₪)",
      "עמלות (₪)",
      "אחוז (%)",
    ];

    const rows: (string | number)[][] = [];

    for (const row of report.rows) {
      rows.push([
        row.name,
        row.code,
        row.brandName,
        Math.round(row.totalRevenue * 100) / 100,
        Math.round(row.totalCommissions * 100) / 100,
        row.commissionPercentage !== null
          ? Math.round(row.commissionPercentage * 100) / 100
          : "N/A",
      ]);
    }

    // Totals row
    const overallPercent =
      report.summary.totalRevenue > 0
        ? Math.round(
            (report.summary.totalCommissions / report.summary.totalRevenue) *
              100 *
              100
          ) / 100
        : "N/A";

    rows.push([
      "סה״כ",
      "",
      "",
      Math.round(report.summary.totalRevenue * 100) / 100,
      Math.round(report.summary.totalCommissions * 100) / 100,
      overallPercent,
    ]);

    // Create workbook
    const wb = XLSX.utils.book_new();
    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    ws["!cols"] = [
      { wch: 25 }, // Name
      { wch: 10 }, // Code
      { wch: 15 }, // Brand
      { wch: 18 }, // Revenue
      { wch: 18 }, // Commissions
      { wch: 12 }, // Percentage
    ];

    // Set RTL direction
    ws["!dir"] = "rtl";

    const quarterLabel = quarter === "annual" ? "שנתי" : `Q${quarter}`;
    XLSX.utils.book_append_sheet(wb, ws, `אחוז עמלות ${quarterLabel}`);

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const brandSuffix = report.brandName ? `-${report.brandName}` : "";
    const qLabel = quarter === "annual" ? "annual" : `Q${quarter}`;
    const filename = `commission-revenue-${year}-${qLabel}${brandSuffix}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (error) {
    console.error("Error exporting commission-revenue report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
