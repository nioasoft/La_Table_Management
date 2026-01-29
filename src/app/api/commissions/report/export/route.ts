import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import * as XLSX from "xlsx";
import {
  getCommissionReportData,
  type CommissionReportFilters,
  type CommissionWithDetails,
  type CommissionSummaryByBrand,
  type CommissionSummaryByPeriod,
  type CommissionSummaryBySupplier,
} from "@/data-access/commissions";
import { formatDateAsLocal } from "@/lib/date-utils";

// Format currency for Excel
const formatCurrency = (amount: number): number => {
  return Math.round(amount * 100) / 100;
};

// Format percentage for Excel
const formatPercent = (rate: number): number => {
  return Math.round(rate * 100) / 100;
};

// Format date for display in Hebrew locale
const formatDateHe = (dateStr: string): string => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("he-IL");
};

// Create Summary sheet
function createSummarySheet(
  report: Awaited<ReturnType<typeof getCommissionReportData>>
): XLSX.WorkSheet {
  const data = [
    ["דוח עמלות - סיכום כללי", ""],
    ["", ""],
    ["תאריך הפקה", formatDateHe(report.summary.generatedAt)],
    ["", ""],
    ["סה״כ עמלות", report.summary.totalCommissions],
    [
      "תקופה",
      report.summary.periodRange.startDate && report.summary.periodRange.endDate
        ? `${formatDateHe(report.summary.periodRange.startDate)} - ${formatDateHe(report.summary.periodRange.endDate)}`
        : "לא זמין",
    ],
    ["", ""],
    ["סה״כ סכום כולל מע״מ (₪)", formatCurrency(report.summary.totalGrossAmount)],
    ["סה״כ סכום לפני מע״מ (₪)", formatCurrency(report.summary.totalNetAmount)],
    [
      "סה״כ סכום עמלה (₪)",
      formatCurrency(report.summary.totalCommissionAmount),
    ],
    ["שיעור עמלה ממוצע (%)", formatPercent(report.summary.avgCommissionRate)],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Set column widths
  ws["!cols"] = [{ wch: 25 }, { wch: 30 }];

  return ws;
}

// Create By Brand sheet
function createByBrandSheet(
  byBrand: CommissionSummaryByBrand[]
): XLSX.WorkSheet {
  const headers = [
    "מותג",
    "מספר עמלות",
    "סכום כולל מע״מ (₪)",
    "סכום לפני מע״מ (₪)",
    "סכום עמלה (₪)",
    "שיעור עמלה ממוצע (%)",
  ];

  const data = byBrand.map((b) => [
    b.brandNameHe,
    b.commissionCount,
    formatCurrency(b.totalGrossAmount),
    formatCurrency(b.totalNetAmount),
    formatCurrency(b.totalCommissionAmount),
    formatPercent(b.avgCommissionRate),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Set column widths
  ws["!cols"] = [
    { wch: 20 }, // Brand name
    { wch: 12 }, // Count
    { wch: 18 }, // Gross
    { wch: 18 }, // Net
    { wch: 18 }, // Commission
    { wch: 20 }, // Rate
  ];

  return ws;
}

// Create By Period sheet
function createByPeriodSheet(
  byPeriod: CommissionSummaryByPeriod[]
): XLSX.WorkSheet {
  const headers = [
    "תאריך התחלה",
    "תאריך סיום",
    "מספר עמלות",
    "סכום כולל מע״מ (₪)",
    "סכום לפני מע״מ (₪)",
    "סכום עמלה (₪)",
  ];

  const data = byPeriod.map((p) => [
    formatDateHe(p.periodStartDate),
    formatDateHe(p.periodEndDate),
    p.commissionCount,
    formatCurrency(p.totalGrossAmount),
    formatCurrency(p.totalNetAmount),
    formatCurrency(p.totalCommissionAmount),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Set column widths
  ws["!cols"] = [
    { wch: 15 }, // Start date
    { wch: 15 }, // End date
    { wch: 12 }, // Count
    { wch: 18 }, // Gross
    { wch: 18 }, // Net
    { wch: 18 }, // Commission
  ];

  return ws;
}

// Create By Supplier sheet
function createBySupplierSheet(
  bySupplier: CommissionSummaryBySupplier[]
): XLSX.WorkSheet {
  const headers = [
    "שם ספק",
    "קוד ספק",
    "מספר עמלות",
    "סכום כולל מע״מ (₪)",
    "סכום לפני מע״מ (₪)",
    "סכום עמלה (₪)",
    "שיעור עמלה ממוצע (%)",
  ];

  const data = bySupplier.map((s) => [
    s.supplierName,
    s.supplierCode,
    s.commissionCount,
    formatCurrency(s.totalGrossAmount),
    formatCurrency(s.totalNetAmount),
    formatCurrency(s.totalCommissionAmount),
    formatPercent(s.avgCommissionRate),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Set column widths
  ws["!cols"] = [
    { wch: 25 }, // Name
    { wch: 12 }, // Code
    { wch: 12 }, // Count
    { wch: 18 }, // Gross
    { wch: 18 }, // Net
    { wch: 18 }, // Commission
    { wch: 20 }, // Rate
  ];

  return ws;
}

// Create Details sheet
function createDetailsSheet(
  details: CommissionWithDetails[]
): XLSX.WorkSheet {
  const headers = [
    "מזהה עמלה",
    "שם ספק",
    "קוד ספק",
    "שם זכיין",
    "קוד זכיין",
    "מותג",
    "תאריך התחלה",
    "תאריך סיום",
    "סכום כולל מע״מ (₪)",
    "סכום לפני מע״מ (₪)",
    "שיעור עמלה (%)",
    "סכום עמלה (₪)",
    "סטטוס",
    "מס׳ חשבונית",
    "תאריך חשבונית",
    "הערות",
    "תאריך יצירה",
  ];

  const statusMap: Record<string, string> = {
    pending: "ממתין",
    calculated: "חושב",
    approved: "מאושר",
    paid: "שולם",
    cancelled: "בוטל",
  };

  const data = details.map((d) => [
    d.id,
    d.supplierName,
    d.supplierCode,
    d.franchiseeName,
    d.franchiseeCode,
    d.brandNameHe,
    formatDateHe(d.periodStartDate),
    formatDateHe(d.periodEndDate),
    formatCurrency(Number(d.grossAmount || 0)),
    formatCurrency(Number(d.netAmount || 0)),
    formatPercent(Number(d.commissionRate || 0)),
    formatCurrency(Number(d.commissionAmount || 0)),
    statusMap[d.status] || d.status,
    d.invoiceNumber || "",
    d.invoiceDate ? formatDateHe(d.invoiceDate) : "",
    d.notes || "",
    d.createdAt ? formatDateHe(d.createdAt.toISOString()) : "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Set column widths
  ws["!cols"] = [
    { wch: 36 }, // ID
    { wch: 25 }, // Supplier name
    { wch: 12 }, // Supplier code
    { wch: 25 }, // Franchisee name
    { wch: 12 }, // Franchisee code
    { wch: 15 }, // Brand
    { wch: 12 }, // Start date
    { wch: 12 }, // End date
    { wch: 15 }, // Gross
    { wch: 15 }, // Net
    { wch: 12 }, // Rate
    { wch: 15 }, // Commission
    { wch: 10 }, // Status
    { wch: 15 }, // Invoice number
    { wch: 12 }, // Invoice date
    { wch: 30 }, // Notes
    { wch: 15 }, // Created at
  ];

  return ws;
}

/**
 * GET /api/commissions/report/export - Export commission report to Excel
 *
 * Query Parameters:
 * - startDate: ISO date string for period start (optional)
 * - endDate: ISO date string for period end (optional)
 * - supplierId: Filter by specific supplier (optional)
 * - brandId: Filter by specific brand (optional)
 * - status: Filter by commission status (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const filters: CommissionReportFilters = {
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      supplierId: searchParams.get("supplierId") || undefined,
      brandId: searchParams.get("brandId") || undefined,
      status: searchParams.get("status") || undefined,
    };

    // Fetch report data
    const reportData = await getCommissionReportData(filters);

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Add sheets
    const summarySheet = createSummarySheet(reportData);
    XLSX.utils.book_append_sheet(wb, summarySheet, "סיכום");

    const byBrandSheet = createByBrandSheet(reportData.byBrand);
    XLSX.utils.book_append_sheet(wb, byBrandSheet, "לפי מותג");

    const byPeriodSheet = createByPeriodSheet(reportData.byPeriod);
    XLSX.utils.book_append_sheet(wb, byPeriodSheet, "לפי תקופה");

    const bySupplierSheet = createBySupplierSheet(reportData.bySupplier);
    XLSX.utils.book_append_sheet(wb, bySupplierSheet, "לפי ספק");

    const detailsSheet = createDetailsSheet(reportData.details);
    XLSX.utils.book_append_sheet(wb, detailsSheet, "פירוט מלא");

    // Generate buffer
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Generate filename with current date
    const today = formatDateAsLocal(new Date());
    const filename = `commission_report_${today}.xlsx`;

    // Return Excel file
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error exporting commission report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
