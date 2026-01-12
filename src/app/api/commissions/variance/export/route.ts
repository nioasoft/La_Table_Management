import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import * as XLSX from "xlsx";
import {
  getVarianceReportData,
  type VarianceReportFilters,
  type VarianceReportData,
  type SupplierVarianceData,
} from "@/data-access/commissions";

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
function createSummarySheet(report: VarianceReportData): XLSX.WorkSheet {
  const data = [
    ["דוח סטיות רכש ספקים - סיכום", ""],
    ["", ""],
    ["תאריך הפקה", formatDateHe(report.summary.generatedAt)],
    ["", ""],
    ["סף סטייה (%)", `${report.summary.varianceThreshold}%`],
    ["", ""],
    ["תקופה נוכחית", ""],
    [
      "  מתאריך",
      formatDateHe(report.summary.currentPeriod.startDate),
    ],
    [
      "  עד תאריך",
      formatDateHe(report.summary.currentPeriod.endDate),
    ],
    ["", ""],
    ["תקופה קודמת", ""],
    [
      "  מתאריך",
      formatDateHe(report.summary.previousPeriod.startDate),
    ],
    [
      "  עד תאריך",
      formatDateHe(report.summary.previousPeriod.endDate),
    ],
    ["", ""],
    ["סה״כ ספקים", report.summary.totalSuppliers],
    ["ספקים עם סטייה", report.summary.flaggedSuppliers],
    ["", ""],
    ["סה״כ רכש תקופה נוכחית (₪)", formatCurrency(report.summary.totalCurrentGross)],
    ["סה״כ רכש תקופה קודמת (₪)", formatCurrency(report.summary.totalPreviousGross)],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Set column widths
  ws["!cols"] = [{ wch: 30 }, { wch: 25 }];

  return ws;
}

// Create All Suppliers sheet
function createAllSuppliersSheet(suppliers: SupplierVarianceData[]): XLSX.WorkSheet {
  const headers = [
    "שם ספק",
    "קוד ספק",
    "רכש נוכחי (₪)",
    "% רכש נוכחי",
    "רכש קודם (₪)",
    "% רכש קודם",
    "סטייה (נק' %)",
    "שינוי (%)",
    "סטייה חריגה",
  ];

  const data = suppliers.map((s) => [
    s.supplierName,
    s.supplierCode,
    formatCurrency(s.currentPeriod.totalGrossAmount),
    formatPercent(s.currentPeriod.purchasePercentage),
    formatCurrency(s.previousPeriod.totalGrossAmount),
    formatPercent(s.previousPeriod.purchasePercentage),
    formatPercent(s.variance),
    formatPercent(s.variancePercent),
    s.isFlagged ? "כן" : "לא",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Set column widths
  ws["!cols"] = [
    { wch: 25 }, // Supplier name
    { wch: 12 }, // Supplier code
    { wch: 18 }, // Current gross
    { wch: 14 }, // Current %
    { wch: 18 }, // Previous gross
    { wch: 14 }, // Previous %
    { wch: 14 }, // Variance
    { wch: 12 }, // Variance %
    { wch: 12 }, // Flagged
  ];

  return ws;
}

// Create Flagged Suppliers sheet
function createFlaggedSuppliersSheet(
  flaggedSuppliers: SupplierVarianceData[],
  threshold: number
): XLSX.WorkSheet {
  if (flaggedSuppliers.length === 0) {
    const data = [
      [`ספקים עם סטייה מעל ${threshold}%`, ""],
      ["", ""],
      ["לא נמצאו ספקים עם סטייה חריגה", ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 40 }, { wch: 20 }];
    return ws;
  }

  const headers = [
    "שם ספק",
    "קוד ספק",
    "רכש נוכחי (₪)",
    "% רכש נוכחי",
    "רכש קודם (₪)",
    "% רכש קודם",
    "סטייה (נק' %)",
    "שינוי (%)",
    "סיבה אפשרית",
  ];

  const data = flaggedSuppliers.map((s) => {
    // Determine possible reason
    let reason = "";
    if (s.previousPeriod.totalGrossAmount === 0) {
      reason = "ספק חדש";
    } else if (s.currentPeriod.totalGrossAmount === 0) {
      reason = "ספק הפסיק לספק";
    } else if (s.variancePercent > 50) {
      reason = "עלייה משמעותית ברכש";
    } else if (s.variancePercent < -50) {
      reason = "ירידה משמעותית ברכש";
    } else {
      reason = "לבדיקה";
    }

    return [
      s.supplierName,
      s.supplierCode,
      formatCurrency(s.currentPeriod.totalGrossAmount),
      formatPercent(s.currentPeriod.purchasePercentage),
      formatCurrency(s.previousPeriod.totalGrossAmount),
      formatPercent(s.previousPeriod.purchasePercentage),
      formatPercent(s.variance),
      formatPercent(s.variancePercent),
      reason,
    ];
  });

  const titleRow = [[`ספקים עם סטייה מעל ${threshold}% (${flaggedSuppliers.length} ספקים)`]];
  const emptyRow = [[""]];

  const ws = XLSX.utils.aoa_to_sheet([...titleRow, ...emptyRow, headers, ...data]);

  // Set column widths
  ws["!cols"] = [
    { wch: 25 }, // Supplier name
    { wch: 12 }, // Supplier code
    { wch: 18 }, // Current gross
    { wch: 14 }, // Current %
    { wch: 18 }, // Previous gross
    { wch: 14 }, // Previous %
    { wch: 14 }, // Variance
    { wch: 12 }, // Variance %
    { wch: 25 }, // Reason
  ];

  return ws;
}

/**
 * GET /api/commissions/variance/export - Export variance report to Excel
 *
 * Query Parameters:
 * - currentStartDate: ISO date string for current period start (required)
 * - currentEndDate: ISO date string for current period end (required)
 * - previousStartDate: ISO date string for previous period start (required)
 * - previousEndDate: ISO date string for previous period end (required)
 * - brandId: Filter by specific brand (optional)
 * - varianceThreshold: Custom threshold percentage (optional, default 10)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const currentStartDate = searchParams.get("currentStartDate");
    const currentEndDate = searchParams.get("currentEndDate");
    const previousStartDate = searchParams.get("previousStartDate");
    const previousEndDate = searchParams.get("previousEndDate");
    const brandId = searchParams.get("brandId") || undefined;
    const varianceThresholdParam = searchParams.get("varianceThreshold");
    const varianceThreshold = varianceThresholdParam
      ? parseFloat(varianceThresholdParam)
      : 10;

    // Validate required parameters
    if (!currentStartDate || !currentEndDate || !previousStartDate || !previousEndDate) {
      return NextResponse.json(
        {
          error: "Missing required parameters. Please provide currentStartDate, currentEndDate, previousStartDate, and previousEndDate.",
        },
        { status: 400 }
      );
    }

    // Build filters
    const filters: VarianceReportFilters = {
      currentStartDate,
      currentEndDate,
      previousStartDate,
      previousEndDate,
      brandId,
      varianceThreshold,
    };

    // Fetch report data
    const reportData = await getVarianceReportData(filters);

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Add sheets
    const summarySheet = createSummarySheet(reportData);
    XLSX.utils.book_append_sheet(wb, summarySheet, "סיכום");

    const flaggedSheet = createFlaggedSuppliersSheet(
      reportData.flaggedOnly,
      varianceThreshold
    );
    XLSX.utils.book_append_sheet(wb, flaggedSheet, "ספקים חריגים");

    const allSuppliersSheet = createAllSuppliersSheet(reportData.suppliers);
    XLSX.utils.book_append_sheet(wb, allSuppliersSheet, "כל הספקים");

    // Generate buffer
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Generate filename with current date
    const today = new Date().toISOString().split("T")[0];
    const filename = `variance_report_${today}.xlsx`;

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
    console.error("Error exporting variance report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
