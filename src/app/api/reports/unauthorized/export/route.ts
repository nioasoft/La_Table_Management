import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import * as XLSX from "xlsx";
import {
  getUnauthorizedSuppliersReport,
  type UnauthorizedSuppliersReport,
  type UnauthorizedSuppliersFilters,
} from "@/data-access/unauthorized-suppliers";
import { formatDateAsLocal } from "@/lib/date-utils";

// Format currency for Excel
const formatCurrency = (amount: number): number => {
  return Math.round(amount * 100) / 100;
};

// Format date for display in Hebrew locale
const formatDateHe = (dateStr: string | null): string => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("he-IL");
};

// Create worksheets for unauthorized suppliers report
function createUnauthorizedSuppliersSheets(
  data: UnauthorizedSuppliersReport,
  wb: XLSX.WorkBook
): void {
  // Summary sheet
  const summaryData = [
    ["דוח ספקים לא מורשים - סיכום כללי", ""],
    ["", ""],
    ["תאריך הפקה", formatDateHe(data.summary.generatedAt)],
    ["", ""],
    ["סה״כ ספקים לא מורשים", data.summary.totalUnauthorizedSuppliers],
    ["סכום כולל (₪)", formatCurrency(data.summary.totalAmount)],
    ["סה״כ עסקאות", data.summary.totalTransactions],
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
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet["!cols"] = [{ wch: 25 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, "סיכום");

  // Suppliers sheet
  const suppliersHeaders = [
    "שם ספק (BKMV)",
    "סכום כולל (₪)",
    "מספר עסקאות",
    "מספר זכיינים",
    "מספר קבצים",
    "נראה לראשונה",
    "נראה לאחרונה",
  ];

  const suppliersData = data.suppliers.map((supplier) => [
    supplier.bkmvName,
    formatCurrency(supplier.totalAmount),
    supplier.transactionCount,
    supplier.franchisees.length,
    supplier.fileCount,
    formatDateHe(supplier.firstSeen),
    formatDateHe(supplier.lastSeen),
  ]);

  const suppliersSheet = XLSX.utils.aoa_to_sheet([
    suppliersHeaders,
    ...suppliersData,
  ]);
  suppliersSheet["!cols"] = [
    { wch: 30 },
    { wch: 15 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 15 },
    { wch: 15 },
  ];
  XLSX.utils.book_append_sheet(wb, suppliersSheet, "ספקים לא מורשים");

  // Detailed breakdown sheet (suppliers by franchisee)
  const detailHeaders = [
    "שם ספק (BKMV)",
    "זכיין",
    "מותג",
    "סכום (₪)",
    "מספר קבצים",
  ];

  const detailData: (string | number)[][] = [];
  for (const supplier of data.suppliers) {
    for (const franchisee of supplier.franchisees) {
      detailData.push([
        supplier.bkmvName,
        franchisee.name,
        franchisee.brandNameHe,
        formatCurrency(franchisee.amount),
        franchisee.fileCount,
      ]);
    }
  }

  const detailSheet = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailData]);
  detailSheet["!cols"] = [
    { wch: 30 },
    { wch: 25 },
    { wch: 15 },
    { wch: 15 },
    { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, detailSheet, "פירוט לפי זכיין");
}

/**
 * GET /api/reports/unauthorized/export - Export unauthorized suppliers report to Excel
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);

    const filters: UnauthorizedSuppliersFilters = {
      brandId: searchParams.get("brandId") || undefined,
      franchiseeId: searchParams.get("franchiseeId") || undefined,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      minAmount: searchParams.get("minAmount")
        ? parseFloat(searchParams.get("minAmount")!)
        : undefined,
    };

    // Fetch report data
    const report = await getUnauthorizedSuppliersReport(filters);

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Create sheets
    createUnauthorizedSuppliersSheets(report, wb);

    // Generate buffer
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Generate filename with current date
    const today = formatDateAsLocal(new Date());
    const filename = `unauthorized-suppliers_${today}.xlsx`;

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
    console.error("Error exporting unauthorized suppliers report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
