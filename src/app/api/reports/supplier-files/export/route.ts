import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import * as XLSX from "xlsx";
import {
  getSupplierFilesReport,
  getStatusLabel,
  type SupplierFilesReport,
  type SupplierFilesFilters,
} from "@/data-access/supplier-file-reports";
import { formatDateAsLocal } from "@/lib/date-utils";

// Format currency for Excel (truncate to 2 decimals)
const formatCurrency = (amount: number): number => {
  return Math.trunc(amount * 100) / 100;
};

// Format date for display in Hebrew locale
const formatDateHe = (dateStr: string | null | Date): string => {
  if (!dateStr) return "";
  const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return date.toLocaleDateString("he-IL");
};

// Format commission rate for display
const formatCommissionRate = (
  rate: number | null,
  type: string | null
): string => {
  if (rate === null) return "-";
  if (type === "percentage") {
    return `${rate}%`;
  }
  return `₪${rate}`;
};

// Create worksheets for supplier files report
function createSupplierFilesSheets(
  data: SupplierFilesReport,
  wb: XLSX.WorkBook
): void {
  // Summary sheet
  const summaryData = [
    ["דוח קבצי ספקים - סיכום כללי", ""],
    ["", ""],
    ["תאריך הפקה", formatDateHe(data.summary.generatedAt)],
    ["", ""],
    ["סה״כ קבצים", data.summary.totalFiles],
    ["ספקים", data.summary.supplierCount],
    ["סה״כ כולל מע״מ (₪)", formatCurrency(data.summary.totalGrossAmount)],
    ["סה״כ לפני מע״מ (₪)", formatCurrency(data.summary.totalNetAmount)],
    ["סה״כ עמלות (₪)", formatCurrency(data.summary.totalCalculatedCommission)],
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
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet["!cols"] = [{ wch: 25 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, "סיכום");

  // By Supplier sheet
  const supplierHeaders = [
    "ספק",
    "קוד ספק",
    "מספר קבצים",
    "סה״כ כולל מע״מ (₪)",
    "סה״כ לפני מע״מ (₪)",
    "סה״כ עמלות (₪)",
  ];

  const supplierData = data.bySupplier.map((s) => [
    s.supplierName,
    s.supplierCode,
    s.fileCount,
    formatCurrency(s.totalGrossAmount),
    formatCurrency(s.totalNetAmount),
    formatCurrency(s.totalCommission),
  ]);

  const supplierSheet = XLSX.utils.aoa_to_sheet([supplierHeaders, ...supplierData]);
  supplierSheet["!cols"] = [
    { wch: 25 },
    { wch: 12 },
    { wch: 12 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, supplierSheet, "לפי ספק");

  // Files detail sheet
  const fileHeaders = [
    "ספק",
    "קוד ספק",
    "שם קובץ",
    "תקופה - התחלה",
    "תקופה - סיום",
    "סטטוס",
    "כולל מע״מ (₪)",
    "לפני מע״מ (₪)",
    "שיעור עמלה",
    "עמלה (₪)",
    "עמלה מחושבת מראש",
    "זכיינים",
    "שורות",
    "תאריך העלאה",
    "הועלה ע״י",
  ];

  const fileData = data.files.map((f) => [
    f.supplierName,
    f.supplierCode,
    f.fileName,
    f.periodStartDate ? formatDateHe(f.periodStartDate) : "-",
    f.periodEndDate ? formatDateHe(f.periodEndDate) : "-",
    getStatusLabel(f.processingStatus),
    formatCurrency(f.totalGrossAmount),
    formatCurrency(f.totalNetAmount),
    formatCommissionRate(f.commissionRate, f.commissionType),
    formatCurrency(f.calculatedCommission),
    f.preCalculatedCommission !== null ? formatCurrency(f.preCalculatedCommission) : "-",
    f.franchiseeCount,
    f.transactionCount,
    formatDateHe(f.uploadedAt),
    f.uploadedByName || "-",
  ]);

  const fileSheet = XLSX.utils.aoa_to_sheet([fileHeaders, ...fileData]);
  fileSheet["!cols"] = [
    { wch: 25 },
    { wch: 12 },
    { wch: 35 },
    { wch: 15 },
    { wch: 15 },
    { wch: 18 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 18 },
    { wch: 10 },
    { wch: 10 },
    { wch: 15 },
    { wch: 15 },
  ];
  XLSX.utils.book_append_sheet(wb, fileSheet, "פירוט קבצים");
}

/**
 * GET /api/reports/supplier-files/export - Export supplier files report to Excel
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);

    const filters: SupplierFilesFilters = {
      supplierId: searchParams.get("supplierId") || undefined,
      brandId: searchParams.get("brandId") || undefined,
      status: searchParams.get("status") || undefined,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
    };

    // Fetch report data
    const report = await getSupplierFilesReport(filters);

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Create sheets
    createSupplierFilesSheets(report, wb);

    // Generate buffer
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Generate filename with current date
    const today = formatDateAsLocal(new Date());
    const filename = `supplier-files-report_${today}.xlsx`;

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
    console.error("Error exporting supplier files report:", error);
    return NextResponse.json(
      { error: "שגיאה בייצוא הדוח" },
      { status: 500 }
    );
  }
}
