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

const MONTH_NAMES_HE = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

/**
 * GET /api/reports/commission-revenue/export - Export commission-to-revenue report to Excel
 *
 * Query parameters:
 * - year: number (required)
 * - startMonth: 1-12 (required)
 * - endMonth: 1-12 (required, >= startMonth)
 * - brandId: string (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;

    const yearStr = searchParams.get("year");
    const startMonthStr = searchParams.get("startMonth");
    const endMonthStr = searchParams.get("endMonth");

    if (!yearStr || !startMonthStr || !endMonthStr) {
      return NextResponse.json(
        { error: "year, startMonth and endMonth are required" },
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

    const startMonth = parseInt(startMonthStr, 10);
    const endMonth = parseInt(endMonthStr, 10);

    if (
      isNaN(startMonth) || isNaN(endMonth) ||
      startMonth < 1 || startMonth > 12 ||
      endMonth < 1 || endMonth > 12 ||
      startMonth > endMonth
    ) {
      return NextResponse.json(
        { error: "startMonth and endMonth must be 1-12, startMonth <= endMonth" },
        { status: 400 }
      );
    }

    const filters: CommissionRevenueReportFilters = {
      year,
      startMonth,
      endMonth,
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
      "קניות כולל מע״מ (₪)",
      "אחוז כולל מע״מ (%)",
      "קניות לפני מע״מ (₪)",
      "אחוז לפני מע״מ (%)",
    ];

    const rows: (string | number)[][] = [];

    for (const row of report.rows) {
      rows.push([
        row.name,
        row.code,
        row.brandName,
        Math.round(row.totalRevenue * 100) / 100,
        Math.round(row.totalSupplierPurchases * 100) / 100,
        row.supplierPurchasesPercentage !== null
          ? Math.round(row.supplierPurchasesPercentage * 100) / 100
          : "N/A",
        Math.round(row.totalSupplierPurchasesBeforeVat * 100) / 100,
        row.supplierPurchasesPercentageBeforeVat !== null
          ? Math.round(row.supplierPurchasesPercentageBeforeVat * 100) / 100
          : "N/A",
      ]);
    }

    // Totals row
    const overallPercent =
      report.summary.totalRevenue > 0
        ? Math.round(
            (report.summary.totalSupplierPurchases / report.summary.totalRevenue) *
              100 *
              100
          ) / 100
        : "N/A";

    const overallPercentBeforeVat =
      report.summary.totalRevenue > 0
        ? Math.round(
            (report.summary.totalSupplierPurchasesBeforeVat / report.summary.totalRevenue) *
              100 *
              100
          ) / 100
        : "N/A";

    rows.push([
      "סה״כ",
      "",
      "",
      Math.round(report.summary.totalRevenue * 100) / 100,
      Math.round(report.summary.totalSupplierPurchases * 100) / 100,
      overallPercent,
      Math.round(report.summary.totalSupplierPurchasesBeforeVat * 100) / 100,
      overallPercentBeforeVat,
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
      { wch: 20 }, // Purchases incl. VAT
      { wch: 16 }, // Percentage incl. VAT
      { wch: 20 }, // Purchases before VAT
      { wch: 16 }, // Percentage before VAT
    ];

    // Set RTL direction
    ws["!dir"] = "rtl";

    // Sheet name based on month range
    const periodLabel = startMonth === endMonth
      ? MONTH_NAMES_HE[startMonth - 1]
      : startMonth === 1 && endMonth === 12
        ? "שנתי"
        : `${MONTH_NAMES_HE[startMonth - 1]}-${MONTH_NAMES_HE[endMonth - 1]}`;
    XLSX.utils.book_append_sheet(wb, ws, `אחוז קניות ${periodLabel}`);

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // Filename based on month range
    const brandSuffix = report.brandName ? `-${report.brandName}` : "";
    const startLabel = `M${String(startMonth).padStart(2, "0")}`;
    const endLabel = `M${String(endMonth).padStart(2, "0")}`;
    const fileLabel = startMonth === endMonth
      ? startLabel
      : startMonth === 1 && endMonth === 12
        ? "annual"
        : `${startLabel}-${endLabel}`;
    const filename = `commission-revenue-${year}-${fileLabel}${brandSuffix}.xlsx`;

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
