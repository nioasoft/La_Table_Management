import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import * as XLSX from "xlsx";
import {
  getUnifiedFilesReport,
  getStatusLabel,
  getSourceLabel,
  type UnifiedFilesReport,
  type UnifiedFilesFilters,
  type UnifiedFileSource,
} from "@/data-access/unified-files";

// Format date for display in Hebrew locale
const formatDateHe = (dateStr: string | null | Date): string => {
  if (!dateStr) return "";
  const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return date.toLocaleDateString("he-IL");
};

// Format file size for display
const formatFileSize = (bytes: number | null): string => {
  if (bytes === null || bytes === undefined) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Get entity type label in Hebrew
const getEntityTypeLabel = (entityType: string | null): string => {
  if (!entityType) return "-";
  const labels: Record<string, string> = {
    supplier: "ספק",
    franchisee: "זכיין",
    upload_link: "קישור העלאה",
  };
  return labels[entityType] || entityType;
};

// Create worksheets for unified files report
function createUnifiedFilesSheets(
  data: UnifiedFilesReport,
  wb: XLSX.WorkBook
): void {
  // Summary sheet
  const summaryData = [
    ["דוח קבצים - סיכום כללי", ""],
    ["", ""],
    ["תאריך הפקה", formatDateHe(data.summary.generatedAt)],
    ["", ""],
    ["סה״כ קבצים", data.summary.totalFiles],
    ["קבצי ספקים", data.summary.supplierFiles],
    ["קבצים אחידים", data.summary.uploadedFiles],
    ["ממתינים לבדיקה", data.summary.pendingReview],
    ["גודל כולל", formatFileSize(data.summary.totalSize)],
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

  // By Source sheet
  const sourceHeaders = [
    "מקור",
    "מספר קבצים",
    "גודל כולל",
  ];

  const sourceData = data.bySource.map((s) => [
    s.label,
    s.count,
    formatFileSize(s.totalSize),
  ]);

  const sourceSheet = XLSX.utils.aoa_to_sheet([sourceHeaders, ...sourceData]);
  sourceSheet["!cols"] = [
    { wch: 20 },
    { wch: 15 },
    { wch: 15 },
  ];
  XLSX.utils.book_append_sheet(wb, sourceSheet, "לפי מקור");

  // All files detail sheet
  const fileHeaders = [
    "מקור",
    "שם קובץ",
    "סוג ישות",
    "שם ישות",
    "תקופה - התחלה",
    "תקופה - סיום",
    "סטטוס",
    "גודל",
    "תאריך העלאה",
    "הועלה ע״י",
  ];

  const fileData = data.files.map((f) => [
    getSourceLabel(f.source),
    f.originalFileName,
    getEntityTypeLabel(f.entityType),
    f.entityName || "-",
    f.periodStartDate ? formatDateHe(f.periodStartDate) : "-",
    f.periodEndDate ? formatDateHe(f.periodEndDate) : "-",
    getStatusLabel(f.processingStatus),
    formatFileSize(f.fileSize),
    formatDateHe(f.createdAt),
    f.uploadedByName || f.uploadedByEmail || "-",
  ]);

  const fileSheet = XLSX.utils.aoa_to_sheet([fileHeaders, ...fileData]);
  fileSheet["!cols"] = [
    { wch: 15 },
    { wch: 40 },
    { wch: 15 },
    { wch: 25 },
    { wch: 15 },
    { wch: 15 },
    { wch: 18 },
    { wch: 12 },
    { wch: 15 },
    { wch: 25 },
  ];
  XLSX.utils.book_append_sheet(wb, fileSheet, "כל הקבצים");

  // Supplier files sheet
  const supplierFiles = data.files.filter((f) => f.source === "supplier");
  if (supplierFiles.length > 0) {
    const supplierFileData = supplierFiles.map((f) => [
      f.originalFileName,
      f.entityName || "-",
      f.periodStartDate ? formatDateHe(f.periodStartDate) : "-",
      f.periodEndDate ? formatDateHe(f.periodEndDate) : "-",
      getStatusLabel(f.processingStatus),
      formatFileSize(f.fileSize),
      formatDateHe(f.createdAt),
      f.uploadedByName || f.uploadedByEmail || "-",
    ]);

    const supplierFileHeaders = [
      "שם קובץ",
      "ספק",
      "תקופה - התחלה",
      "תקופה - סיום",
      "סטטוס",
      "גודל",
      "תאריך העלאה",
      "הועלה ע״י",
    ];

    const supplierFileSheet = XLSX.utils.aoa_to_sheet([supplierFileHeaders, ...supplierFileData]);
    supplierFileSheet["!cols"] = [
      { wch: 40 },
      { wch: 25 },
      { wch: 15 },
      { wch: 15 },
      { wch: 18 },
      { wch: 12 },
      { wch: 15 },
      { wch: 25 },
    ];
    XLSX.utils.book_append_sheet(wb, supplierFileSheet, "קבצי ספקים");
  }

  // Uploaded files sheet
  const uploadedFiles = data.files.filter((f) => f.source === "uploaded");
  if (uploadedFiles.length > 0) {
    const uploadedFileData = uploadedFiles.map((f) => [
      f.originalFileName,
      getEntityTypeLabel(f.entityType),
      f.entityName || "-",
      f.periodStartDate ? formatDateHe(f.periodStartDate) : "-",
      f.periodEndDate ? formatDateHe(f.periodEndDate) : "-",
      getStatusLabel(f.processingStatus),
      formatFileSize(f.fileSize),
      formatDateHe(f.createdAt),
      f.uploadedByEmail || "-",
    ]);

    const uploadedFileHeaders = [
      "שם קובץ",
      "סוג ישות",
      "שם ישות",
      "תקופה - התחלה",
      "תקופה - סיום",
      "סטטוס",
      "גודל",
      "תאריך העלאה",
      "אימייל מעלה",
    ];

    const uploadedFileSheet = XLSX.utils.aoa_to_sheet([uploadedFileHeaders, ...uploadedFileData]);
    uploadedFileSheet["!cols"] = [
      { wch: 40 },
      { wch: 15 },
      { wch: 25 },
      { wch: 15 },
      { wch: 15 },
      { wch: 18 },
      { wch: 12 },
      { wch: 15 },
      { wch: 25 },
    ];
    XLSX.utils.book_append_sheet(wb, uploadedFileSheet, "קבצים אחידים");
  }
}

/**
 * GET /api/reports/files/export - Export unified files report to Excel
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);

    const filters: UnifiedFilesFilters = {
      source: searchParams.get("source") as UnifiedFileSource | undefined,
      entityType: searchParams.get("entityType") as "supplier" | "franchisee" | undefined,
      status: searchParams.get("status") || undefined,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
    };

    // Fetch report data
    const report = await getUnifiedFilesReport(filters);

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Create sheets
    createUnifiedFilesSheets(report, wb);

    // Generate buffer
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Generate filename with current date
    const today = new Date().toISOString().split("T")[0];
    const filename = `files-report_${today}.xlsx`;

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
    console.error("Error exporting unified files report:", error);
    return NextResponse.json(
      { error: "שגיאה בייצוא הדוח" },
      { status: 500 }
    );
  }
}
