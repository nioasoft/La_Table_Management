import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import * as XLSX from "xlsx";
import {
  getReportData,
  type ReportFilters,
  type ReportType,
  type CommissionReportData,
  type SettlementReportData,
  type FranchiseeReportData,
  type SupplierReportData,
} from "@/data-access/reports";
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
const formatDateHe = (dateStr: string | null): string => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("he-IL");
};

// Status translations
const commissionStatusMap: Record<string, string> = {
  pending: "ממתין",
  calculated: "חושב",
  approved: "מאושר",
  paid: "שולם",
  cancelled: "בוטל",
};

const settlementStatusMap: Record<string, string> = {
  draft: "טיוטה",
  pending: "ממתין",
  approved: "מאושר",
  completed: "הושלם",
  cancelled: "בוטל",
  open: "פתוח",
  processing: "בעיבוד",
  pending_approval: "ממתין לאישור",
  invoiced: "הופק חשבון",
};

const franchiseeStatusMap: Record<string, string> = {
  active: "פעיל",
  inactive: "לא פעיל",
  pending: "ממתין",
  suspended: "מושעה",
  terminated: "סיום חוזה",
};

// Create Commission Report Sheets
function createCommissionSheets(
  data: CommissionReportData,
  wb: XLSX.WorkBook
): void {
  // Summary sheet
  const summaryData = [
    ["דוח עמלות - סיכום כללי", ""],
    ["", ""],
    ["תאריך הפקה", formatDateHe(data.generatedAt)],
    ["", ""],
    ["סה״כ רשומות", data.summary.totalRecords],
    ["סה״כ סכום כולל מע״מ (₪)", formatCurrency(data.summary.totalGrossAmount)],
    ["סה״כ סכום לפני מע״מ (₪)", formatCurrency(data.summary.totalNetAmount)],
    ["סה״כ סכום עמלה (₪)", formatCurrency(data.summary.totalCommissionAmount)],
    ["שיעור עמלה ממוצע (%)", formatPercent(data.summary.avgCommissionRate)],
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet["!cols"] = [{ wch: 25 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, "סיכום");

  // Details sheet
  const headers = [
    "ספק",
    "קוד ספק",
    "זכיין",
    "קוד זכיין",
    "מותג",
    "תאריך התחלה",
    "תאריך סיום",
    "סכום כולל מע״מ (₪)",
    "סכום לפני מע״מ (₪)",
    "שיעור עמלה (%)",
    "סכום עמלה (₪)",
    "סטטוס",
  ];

  const detailsData = data.rows.map((row) => [
    row.supplierName,
    row.supplierCode,
    row.franchiseeName,
    row.franchiseeCode,
    row.brandNameHe,
    formatDateHe(row.periodStartDate),
    formatDateHe(row.periodEndDate),
    formatCurrency(Number(row.grossAmount || 0)),
    formatCurrency(Number(row.netAmount || 0)),
    formatPercent(Number(row.commissionRate || 0)),
    formatCurrency(Number(row.commissionAmount || 0)),
    commissionStatusMap[row.status] || row.status,
  ]);

  const detailsSheet = XLSX.utils.aoa_to_sheet([headers, ...detailsData]);
  detailsSheet["!cols"] = [
    { wch: 25 },
    { wch: 12 },
    { wch: 25 },
    { wch: 12 },
    { wch: 15 },
    { wch: 12 },
    { wch: 12 },
    { wch: 15 },
    { wch: 15 },
    { wch: 12 },
    { wch: 15 },
    { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, detailsSheet, "פירוט");
}

// Create Settlement Report Sheets
function createSettlementSheets(
  data: SettlementReportData,
  wb: XLSX.WorkBook
): void {
  // Summary sheet
  const summaryData = [
    ["דוח התחשבנויות - סיכום כללי", ""],
    ["", ""],
    ["תאריך הפקה", formatDateHe(data.generatedAt)],
    ["", ""],
    ["סה״כ רשומות", data.summary.totalRecords],
    ["סה״כ מכירות כולל מע״מ (₪)", formatCurrency(data.summary.totalGrossSales)],
    ["סה״כ מכירות לפני מע״מ (₪)", formatCurrency(data.summary.totalNetSales)],
    ["סה״כ תמלוגים (₪)", formatCurrency(data.summary.totalRoyaltyAmount)],
    ["סה״כ לתשלום לפני מע״מ (₪)", formatCurrency(data.summary.totalNetPayable)],
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet["!cols"] = [{ wch: 25 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, "סיכום");

  // Details sheet
  const headers = [
    "שם תקופה",
    "זכיין",
    "קוד זכיין",
    "מותג",
    "סוג תקופה",
    "תאריך התחלה",
    "תאריך סיום",
    "סטטוס",
    "מכירות כולל מע״מ (₪)",
    "מכירות לפני מע״מ (₪)",
    "תמלוגים (₪)",
    "דמי שיווק (₪)",
    "לתשלום לפני מע״מ (₪)",
  ];

  const detailsData = data.rows.map((row) => [
    row.name,
    row.franchiseeName,
    row.franchiseeCode,
    row.brandNameHe,
    row.periodType,
    formatDateHe(row.periodStartDate),
    formatDateHe(row.periodEndDate),
    settlementStatusMap[row.status] || row.status,
    formatCurrency(Number(row.grossSales || 0)),
    formatCurrency(Number(row.netSales || 0)),
    formatCurrency(Number(row.royaltyAmount || 0)),
    formatCurrency(Number(row.marketingFeeAmount || 0)),
    formatCurrency(Number(row.netPayable || 0)),
  ]);

  const detailsSheet = XLSX.utils.aoa_to_sheet([headers, ...detailsData]);
  detailsSheet["!cols"] = [
    { wch: 20 },
    { wch: 25 },
    { wch: 12 },
    { wch: 15 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 12 },
    { wch: 12 },
    { wch: 15 },
  ];
  XLSX.utils.book_append_sheet(wb, detailsSheet, "פירוט");
}

// Create Franchisee Report Sheets
function createFranchiseeSheets(
  data: FranchiseeReportData,
  wb: XLSX.WorkBook
): void {
  // Summary sheet
  const summaryData = [
    ["דוח זכיינים - סיכום כללי", ""],
    ["", ""],
    ["תאריך הפקה", formatDateHe(data.generatedAt)],
    ["", ""],
    ["סה״כ זכיינים", data.summary.totalRecords],
    ["פעילים", data.summary.activeCount],
    ["לא פעילים", data.summary.inactiveCount],
    ["ממתינים", data.summary.pendingCount],
    ["", ""],
    ["לפי מותג:", ""],
    ...data.summary.byBrand.map((b) => [b.brandNameHe, b.count]),
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet["!cols"] = [{ wch: 25 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, "סיכום");

  // Details sheet
  const headers = [
    "שם זכיין",
    "קוד",
    "מותג",
    "סטטוס",
    "עיר",
    "אימייל",
    "טלפון",
    "תאריך פתיחה",
    "פעיל",
  ];

  const detailsData = data.rows.map((row) => [
    row.name,
    row.code,
    row.brandNameHe,
    franchiseeStatusMap[row.status] || row.status,
    row.city || "",
    row.contactEmail || "",
    row.contactPhone || "",
    row.openingDate ? formatDateHe(row.openingDate) : "",
    row.isActive ? "כן" : "לא",
  ]);

  const detailsSheet = XLSX.utils.aoa_to_sheet([headers, ...detailsData]);
  detailsSheet["!cols"] = [
    { wch: 25 },
    { wch: 12 },
    { wch: 15 },
    { wch: 12 },
    { wch: 15 },
    { wch: 25 },
    { wch: 15 },
    { wch: 12 },
    { wch: 8 },
  ];
  XLSX.utils.book_append_sheet(wb, detailsSheet, "פירוט");
}

// Create Supplier Report Sheets
function createSupplierSheets(
  data: SupplierReportData,
  wb: XLSX.WorkBook
): void {
  // Summary sheet
  const summaryData = [
    ["דוח ספקים - סיכום כללי", ""],
    ["", ""],
    ["תאריך הפקה", formatDateHe(data.generatedAt)],
    ["", ""],
    ["סה״כ ספקים", data.summary.totalRecords],
    ["ספקים פעילים", data.summary.activeCount],
    ["סה״כ עמלות (₪)", formatCurrency(data.summary.totalCommissionAmount)],
    ["שיעור עמלה ממוצע (%)", formatPercent(data.summary.avgCommissionRate)],
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet["!cols"] = [{ wch: 25 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, "סיכום");

  // Details sheet
  const headers = [
    "שם ספק",
    "קוד",
    "איש קשר",
    "אימייל",
    "טלפון",
    "שיעור עמלה (%)",
    "סוג עמלה",
    "תדירות התחשבנות",
    "פעיל",
    "מספר עמלות",
    "סה״כ עמלות (₪)",
  ];

  const commissionTypeMap: Record<string, string> = {
    percentage: "אחוז",
    per_item: "לפריט",
  };

  const frequencyMap: Record<string, string> = {
    weekly: "שבועי",
    bi_weekly: "דו-שבועי",
    monthly: "חודשי",
    quarterly: "רבעוני",
  };

  const detailsData = data.rows.map((row) => [
    row.name,
    row.code,
    row.contactName || "",
    row.contactEmail || "",
    row.contactPhone || "",
    formatPercent(Number(row.defaultCommissionRate || 0)),
    row.commissionType ? commissionTypeMap[row.commissionType] || row.commissionType : "",
    row.settlementFrequency ? frequencyMap[row.settlementFrequency] || row.settlementFrequency : "",
    row.isActive ? "כן" : "לא",
    row.totalCommissions,
    formatCurrency(row.totalCommissionAmount),
  ]);

  const detailsSheet = XLSX.utils.aoa_to_sheet([headers, ...detailsData]);
  detailsSheet["!cols"] = [
    { wch: 25 },
    { wch: 12 },
    { wch: 20 },
    { wch: 25 },
    { wch: 15 },
    { wch: 12 },
    { wch: 12 },
    { wch: 15 },
    { wch: 8 },
    { wch: 12 },
    { wch: 15 },
  ];
  XLSX.utils.book_append_sheet(wb, detailsSheet, "פירוט");
}

// Report type titles
const reportTitles: Record<ReportType, string> = {
  commissions: "עמלות",
  settlements: "התחשבנויות",
  franchisees: "זכיינים",
  suppliers: "ספקים",
};

/**
 * GET /api/reports/export - Export report to Excel
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const reportType = (searchParams.get("reportType") as ReportType) || "commissions";

    const filters: ReportFilters = {
      reportType,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      brandId: searchParams.get("brandId") || undefined,
      supplierId: searchParams.get("supplierId") || undefined,
      franchiseeId: searchParams.get("franchiseeId") || undefined,
      status: searchParams.get("status") || undefined,
    };

    // Fetch report data
    const reportData = await getReportData(filters);

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Create sheets based on report type
    switch (reportType) {
      case "commissions":
        createCommissionSheets(reportData as CommissionReportData, wb);
        break;
      case "settlements":
        createSettlementSheets(reportData as SettlementReportData, wb);
        break;
      case "franchisees":
        createFranchiseeSheets(reportData as FranchiseeReportData, wb);
        break;
      case "suppliers":
        createSupplierSheets(reportData as SupplierReportData, wb);
        break;
    }

    // Generate buffer
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Generate filename with current date
    const today = formatDateAsLocal(new Date());
    const filename = `report_${reportType}_${today}.xlsx`;

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
    console.error("Error exporting report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
