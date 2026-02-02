import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import * as XLSX from "xlsx";
import {
  getSettlementSimpleReport,
  type SettlementSimpleFilters,
  type SettlementLineItem,
  type SettlementSummary,
} from "@/data-access/settlement-simple";
import { formatDateAsLocal } from "@/lib/date-utils";

// Format currency for Excel (truncate to 2 decimals)
const formatCurrency = (amount: number): number => {
  return Math.trunc(amount * 100) / 100;
};

// Format percentage for Excel
const formatPercent = (rate: number | null): string => {
  if (rate === null) return "-";
  return `${rate.toFixed(2)}%`;
};

// Format date for display in Hebrew locale
const formatDateHe = (dateStr: string): string => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("he-IL");
};

// Create Summary sheet
function createSummarySheet(summary: SettlementSummary): XLSX.WorkSheet {
  const data = [
    ["דוח התחשבנות פשוט - סיכום", ""],
    ["", ""],
    ["תאריך הפקה", formatDateHe(summary.generatedAt)],
    ["", ""],
    ["תקופה", `${formatDateHe(summary.periodStartDate)} - ${formatDateHe(summary.periodEndDate)}`],
    ["", ""],
    ["סה״כ רשומות", summary.totalCount],
    ["התאמות (הפרש <= ₪10)", summary.matchedCount],
    ["פערים (הפרש > ₪10)", summary.unmatchedCount],
    ["", ""],
    ["סה״כ סכום ספקים (₪)", formatCurrency(summary.totalSupplierAmount)],
    ["סה״כ סכום זכיינים (₪)", formatCurrency(summary.totalFranchiseeAmount)],
    ["הפרש כולל (₪)", formatCurrency(summary.totalDifference)],
    ["", ""],
    ["עמלה לתשלום (₪)", formatCurrency(summary.totalCommissionAmount)],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Set column widths
  ws["!cols"] = [{ wch: 30 }, { wch: 25 }];

  return ws;
}

// Create Details sheet
function createDetailsSheet(items: SettlementLineItem[]): XLSX.WorkSheet {
  const headers = [
    "ספק",
    "קוד ספק",
    "זכיין",
    "קוד זכיין",
    "מותג",
    "סכום ספק (₪)",
    "סכום זכיין (₪)",
    "הפרש (₪)",
    "אחוז הפרש",
    "% עמלה",
    "עמלה (₪)",
    "סטטוס",
    "התאמה",
    "תיקון",
  ];

  const statusMap: Record<string, string> = {
    pending: "ממתין",
    calculated: "חושב",
    approved: "מאושר",
    paid: "שולם",
    cancelled: "בוטל",
  };

  const data = items.map((item) => [
    item.supplierName,
    item.supplierCode,
    item.franchiseeName,
    item.franchiseeCode,
    item.brandNameHe,
    formatCurrency(item.supplierAmount),
    item.franchiseeAmount !== null ? formatCurrency(item.franchiseeAmount) : "-",
    formatCurrency(item.difference),
    formatPercent(item.differencePercent),
    formatPercent(item.commissionRate),
    formatCurrency(item.commissionAmount),
    statusMap[item.status] || item.status,
    item.isMatched ? "V" : "X",
    item.hasAdjustment ? "יש" : "-",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Set column widths
  ws["!cols"] = [
    { wch: 20 }, // Supplier name
    { wch: 10 }, // Supplier code
    { wch: 20 }, // Franchisee name
    { wch: 10 }, // Franchisee code
    { wch: 12 }, // Brand
    { wch: 15 }, // Supplier amount
    { wch: 15 }, // Franchisee amount
    { wch: 12 }, // Difference
    { wch: 12 }, // Difference percent
    { wch: 10 }, // Commission rate
    { wch: 12 }, // Commission amount
    { wch: 10 }, // Status
    { wch: 8 }, // Match
    { wch: 8 }, // Adjustment
  ];

  return ws;
}

// Create Discrepancies sheet (only items with difference > 10)
function createDiscrepanciesSheet(items: SettlementLineItem[]): XLSX.WorkSheet {
  const discrepancies = items.filter((item) => !item.isMatched);

  const headers = [
    "ספק",
    "זכיין",
    "מותג",
    "סכום ספק (₪)",
    "סכום זכיין (₪)",
    "הפרש (₪)",
    "אחוז הפרש",
    "יש תיקון",
  ];

  const data = discrepancies.map((item) => [
    item.supplierName,
    item.franchiseeName,
    item.brandNameHe,
    formatCurrency(item.supplierAmount),
    item.franchiseeAmount !== null ? formatCurrency(item.franchiseeAmount) : "-",
    formatCurrency(item.difference),
    formatPercent(item.differencePercent),
    item.hasAdjustment ? "כן" : "לא",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Set column widths
  ws["!cols"] = [
    { wch: 20 }, // Supplier name
    { wch: 20 }, // Franchisee name
    { wch: 12 }, // Brand
    { wch: 15 }, // Supplier amount
    { wch: 15 }, // Franchisee amount
    { wch: 12 }, // Difference
    { wch: 12 }, // Difference percent
    { wch: 10 }, // Has adjustment
  ];

  return ws;
}

/**
 * GET /api/settlement-simple/export - Export settlement report to Excel
 *
 * Query Parameters:
 * - periodStartDate: Start date (required)
 * - periodEndDate: End date (required)
 * - supplierId: Filter by supplier (optional)
 * - franchiseeId: Filter by franchisee (optional)
 * - brandId: Filter by brand (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);

    const periodStartDate = searchParams.get("periodStartDate");
    const periodEndDate = searchParams.get("periodEndDate");

    if (!periodStartDate || !periodEndDate) {
      return NextResponse.json(
        { error: "Missing required parameters: periodStartDate and periodEndDate" },
        { status: 400 }
      );
    }

    // Build filters
    const filters: SettlementSimpleFilters = {
      periodStartDate,
      periodEndDate,
      supplierId: searchParams.get("supplierId") || undefined,
      franchiseeId: searchParams.get("franchiseeId") || undefined,
      brandId: searchParams.get("brandId") || undefined,
    };

    // Get report data
    const report = await getSettlementSimpleReport(filters);

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Add sheets
    const summarySheet = createSummarySheet(report.summary);
    XLSX.utils.book_append_sheet(wb, summarySheet, "סיכום");

    const detailsSheet = createDetailsSheet(report.items);
    XLSX.utils.book_append_sheet(wb, detailsSheet, "פירוט מלא");

    const discrepanciesSheet = createDiscrepanciesSheet(report.items);
    XLSX.utils.book_append_sheet(wb, discrepanciesSheet, "פערים");

    // Generate buffer
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Generate filename with current date
    const today = formatDateAsLocal(new Date());
    const filename = `settlement_report_${today}.xlsx`;

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
    console.error("Error exporting settlement report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
