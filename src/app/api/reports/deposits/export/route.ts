import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import * as XLSX from "xlsx";
import {
  getDepositsReport,
  type DepositsReport,
  type DepositsFilters,
} from "@/data-access/deposits";
import { formatDateAsLocal } from "@/lib/date-utils";

// Format currency for Excel
const formatCurrency = (amount: number): number => {
  return Math.round(amount * 100) / 100;
};

// Format date for display in Hebrew locale
const formatDateHe = (dateStr: string | null | Date): string => {
  if (!dateStr) return "";
  const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return date.toLocaleDateString("he-IL");
};

// Create worksheets for deposits report
function createDepositsSheets(data: DepositsReport, wb: XLSX.WorkBook): void {
  // Summary sheet
  const summaryData = [
    ["דוח פיקדונות - סיכום כללי", ""],
    ["", ""],
    ["תאריך הפקה", formatDateHe(data.summary.generatedAt)],
    ["", ""],
    ["סה״כ פיקדונות", data.summary.totalDeposits],
    ["סכום כולל (₪)", formatCurrency(data.summary.totalDepositAmount)],
    ["זכיינים מושפעים", data.summary.affectedFranchisees],
    ["", ""],
    ["טווח תקופה:", ""],
    [
      "מתאריך",
      data.summary.periodRange.startDate
        ? formatDateHe(data.summary.periodRange.startDate)
        : "לא זמין",
    ],
    [
      "עד תאריך",
      data.summary.periodRange.endDate
        ? formatDateHe(data.summary.periodRange.endDate)
        : "לא זמין",
    ],
    ["", ""],
    ["מימד ספק זמין", data.summary.hasSupplierDimension ? "כן" : "לא"],
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet["!cols"] = [{ wch: 25 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, "סיכום");

  // By Franchisee sheet
  const franchiseeHeaders = [
    "זכיין",
    "מותג",
    "מספר פיקדונות",
    "סכום כולל (₪)",
    "יתרה (₪)",
    "תאריך אחרון",
  ];

  const franchiseeData = data.byFranchisee.map((f) => [
    f.franchiseeName,
    f.brandNameHe,
    f.depositCount,
    formatCurrency(f.totalDeposits),
    formatCurrency(f.runningBalance),
    f.lastDepositDate ? formatDateHe(f.lastDepositDate) : "-",
  ]);

  const franchiseeSheet = XLSX.utils.aoa_to_sheet([
    franchiseeHeaders,
    ...franchiseeData,
  ]);
  franchiseeSheet["!cols"] = [
    { wch: 25 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
  ];
  XLSX.utils.book_append_sheet(wb, franchiseeSheet, "לפי זכיין");

  // By Brand sheet
  const brandHeaders = [
    "מותג",
    "מספר פיקדונות",
    "מספר זכיינים",
    "סכום כולל (₪)",
  ];

  const brandData = data.byBrand.map((b) => [
    b.brandNameHe,
    b.depositCount,
    b.franchiseeCount,
    formatCurrency(b.totalDeposits),
  ]);

  const brandSheet = XLSX.utils.aoa_to_sheet([brandHeaders, ...brandData]);
  brandSheet["!cols"] = [{ wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, brandSheet, "לפי מותג");

  // Details sheet
  const detailHeaders = [
    "זכיין",
    "מותג",
    "סכום (₪)",
    "יתרה מצטברת (₪)",
    "סיבה",
    "תיאור",
    "אסמכתא",
    "תאריך אפקטיבי",
    "תקופה",
    "סטטוס",
    "נוצר ע״י",
    "אושר ע״י",
  ];

  const detailData = data.details.map((d) => [
    d.franchiseeName,
    d.brandNameHe,
    formatCurrency(d.amount),
    formatCurrency(d.runningBalance),
    d.reason,
    d.description || "",
    d.referenceNumber || "",
    d.effectiveDate ? formatDateHe(d.effectiveDate) : "-",
    d.settlementPeriodName,
    d.approvedAt ? "מאושר" : "ממתין",
    d.createdByName || "-",
    d.approvedByName || "-",
  ]);

  const detailSheet = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailData]);
  detailSheet["!cols"] = [
    { wch: 25 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 20 },
    { wch: 30 },
    { wch: 15 },
    { wch: 15 },
    { wch: 20 },
    { wch: 10 },
    { wch: 15 },
    { wch: 15 },
  ];
  XLSX.utils.book_append_sheet(wb, detailSheet, "פירוט מלא");
}

/**
 * GET /api/reports/deposits/export - Export deposits report to Excel
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);

    const filters: DepositsFilters = {
      brandId: searchParams.get("brandId") || undefined,
      franchiseeId: searchParams.get("franchiseeId") || undefined,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      minAmount: searchParams.get("minAmount")
        ? parseFloat(searchParams.get("minAmount")!)
        : undefined,
    };

    // Fetch report data
    const report = await getDepositsReport(filters);

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Create sheets
    createDepositsSheets(report, wb);

    // Generate buffer
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Generate filename with current date
    const today = formatDateAsLocal(new Date());
    const filename = `deposits-report_${today}.xlsx`;

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
    console.error("Error exporting deposits report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
