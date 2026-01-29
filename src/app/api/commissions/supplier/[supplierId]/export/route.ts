import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import * as XLSX from "xlsx";
import {
  getPerSupplierReportData,
  type PerSupplierReportFilters,
  type PerSupplierReportData,
  type SupplierFranchiseeCommission,
  type SupplierCommissionPeriod,
  type CommissionWithDetails,
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
function createSummarySheet(report: PerSupplierReportData): XLSX.WorkSheet {
  const data = [
    [`דוח עמלות לספק: ${report.supplier.name}`, ""],
    ["", ""],
    ["פרטי ספק", ""],
    ["קוד ספק", report.supplier.code],
    ["שיעור עמלה", report.supplier.defaultCommissionRate ? `${report.supplier.defaultCommissionRate}%` : "לא הוגדר"],
    ["סוג עמלה", report.supplier.commissionType === "percentage" ? "אחוזים" : "לפריט"],
    ["תדירות התחשבנות", translateFrequency(report.supplier.settlementFrequency)],
    ["מע״מ כלול", report.supplier.vatIncluded ? "כן" : "לא"],
    ["", ""],
    ["סיכום דוח", ""],
    ["תאריך הפקה", formatDateHe(report.summary.generatedAt)],
    [
      "תקופה",
      report.summary.periodRange.startDate && report.summary.periodRange.endDate
        ? `${formatDateHe(report.summary.periodRange.startDate)} - ${formatDateHe(report.summary.periodRange.endDate)}`
        : "לא זמין",
    ],
    ["", ""],
    ["סה״כ זכיינים", report.summary.totalFranchisees],
    ["סה״כ עמלות", report.summary.totalCommissions],
    ["סה״כ סכום כולל מע״מ (₪)", formatCurrency(report.summary.totalGrossAmount)],
    ["סה״כ סכום לפני מע״מ (₪)", formatCurrency(report.summary.totalNetAmount)],
    ["סה״כ סכום עמלה (₪)", formatCurrency(report.summary.totalCommissionAmount)],
    ["שיעור עמלה ממוצע (%)", formatPercent(report.summary.avgCommissionRate)],
  ];

  // Add comparison data if available
  if (report.comparison) {
    data.push(["", ""]);
    data.push(["השוואה לתקופה קודמת", ""]);
    data.push(["סכום כולל מע״מ קודם (₪)", formatCurrency(report.comparison.previousPeriod.totalGrossAmount)]);
    data.push(["שינוי בסכום כולל מע״מ (₪)", formatCurrency(report.comparison.changes.grossAmountChange)]);
    data.push(["שינוי בסכום כולל מע״מ (%)", formatPercent(report.comparison.changes.grossAmountChangePercent)]);
    data.push(["סכום עמלה קודם (₪)", formatCurrency(report.comparison.previousPeriod.totalCommissionAmount)]);
    data.push(["שינוי בסכום עמלה (₪)", formatCurrency(report.comparison.changes.commissionAmountChange)]);
    data.push(["שינוי בסכום עמלה (%)", formatPercent(report.comparison.changes.commissionAmountChangePercent)]);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Set column widths
  ws["!cols"] = [{ wch: 30 }, { wch: 35 }];

  return ws;
}

function translateFrequency(frequency: string | null): string {
  const map: Record<string, string> = {
    weekly: "שבועי",
    bi_weekly: "דו-שבועי",
    monthly: "חודשי",
    quarterly: "רבעוני",
    semi_annual: "חצי שנתי",
    annual: "שנתי",
  };
  return frequency ? map[frequency] || frequency : "לא הוגדר";
}

// Create By Franchisee sheet
function createByFranchiseeSheet(
  byFranchisee: SupplierFranchiseeCommission[]
): XLSX.WorkSheet {
  const headers = [
    "שם זכיין",
    "קוד זכיין",
    "מותג",
    "מספר עמלות",
    "סכום כולל מע״מ (₪)",
    "סכום לפני מע״מ (₪)",
    "סכום עמלה (₪)",
    "שיעור עמלה ממוצע (%)",
  ];

  const data = byFranchisee.map((f) => [
    f.franchiseeName,
    f.franchiseeCode,
    f.brandNameHe,
    f.commissionCount,
    formatCurrency(f.totalGrossAmount),
    formatCurrency(f.totalNetAmount),
    formatCurrency(f.totalCommissionAmount),
    formatPercent(f.avgCommissionRate),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Set column widths
  ws["!cols"] = [
    { wch: 25 }, // Franchisee name
    { wch: 12 }, // Code
    { wch: 15 }, // Brand
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
  byPeriod: SupplierCommissionPeriod[]
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

// Create Details sheet
function createDetailsSheet(details: CommissionWithDetails[]): XLSX.WorkSheet {
  const headers = [
    "מזהה עמלה",
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
 * GET /api/commissions/supplier/[supplierId]/export - Export per-supplier commission report to Excel
 *
 * Query Parameters:
 * - startDate: ISO date string for period start (optional)
 * - endDate: ISO date string for period end (optional)
 * - brandId: Filter by specific brand (optional)
 * - status: Filter by commission status (optional)
 * - compareStartDate: ISO date string for comparison period start (optional)
 * - compareEndDate: ISO date string for comparison period end (optional)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ supplierId: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { supplierId } = await params;

    if (!supplierId) {
      return NextResponse.json(
        { error: "Supplier ID is required" },
        { status: 400 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const filters: PerSupplierReportFilters = {
      supplierId,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      brandId: searchParams.get("brandId") || undefined,
      status: searchParams.get("status") || undefined,
      compareStartDate: searchParams.get("compareStartDate") || undefined,
      compareEndDate: searchParams.get("compareEndDate") || undefined,
    };

    // Fetch report data
    const reportData = await getPerSupplierReportData(filters);

    if (!reportData) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      );
    }

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Add sheets
    const summarySheet = createSummarySheet(reportData);
    XLSX.utils.book_append_sheet(wb, summarySheet, "סיכום");

    const byFranchiseeSheet = createByFranchiseeSheet(reportData.byFranchisee);
    XLSX.utils.book_append_sheet(wb, byFranchiseeSheet, "לפי זכיין");

    const byPeriodSheet = createByPeriodSheet(reportData.byPeriod);
    XLSX.utils.book_append_sheet(wb, byPeriodSheet, "לפי תקופה");

    const detailsSheet = createDetailsSheet(reportData.details);
    XLSX.utils.book_append_sheet(wb, detailsSheet, "פירוט מלא");

    // Generate buffer
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Generate filename with supplier code and current date
    const today = formatDateAsLocal(new Date());
    const supplierCode = reportData.supplier.code.replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `supplier_commission_report_${supplierCode}_${today}.xlsx`;

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
    console.error("Error exporting per-supplier commission report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
