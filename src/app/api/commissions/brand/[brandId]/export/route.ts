import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import * as XLSX from "xlsx";
import {
  getPerBrandReportData,
  type PerBrandReportFilters,
  type PerBrandReportData,
  type BrandFranchiseeCommission,
  type BrandSupplierCommission,
  type BrandCommissionPeriod,
  type CommissionWithDetails,
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
function createSummarySheet(report: PerBrandReportData): XLSX.WorkSheet {
  const data = [
    [`דוח עמלות למותג: ${report.brand.nameHe}`, ""],
    ["", ""],
    ["פרטי מותג", ""],
    ["קוד מותג", report.brand.code],
    ["שם באנגלית", report.brand.nameEn || "לא הוגדר"],
    ["אימייל ליצירת קשר", report.brand.contactEmail || "לא הוגדר"],
    ["טלפון ליצירת קשר", report.brand.contactPhone || "לא הוגדר"],
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
    ["סה״כ ספקים", report.summary.totalSuppliers],
    ["סה״כ עמלות", report.summary.totalCommissions],
    ["סה״כ סכום ברוטו (₪)", formatCurrency(report.summary.totalGrossAmount)],
    ["סה״כ סכום נטו (₪)", formatCurrency(report.summary.totalNetAmount)],
    ["סה״כ סכום עמלה (₪)", formatCurrency(report.summary.totalCommissionAmount)],
    ["שיעור עמלה ממוצע (%)", formatPercent(report.summary.avgCommissionRate)],
    ["", ""],
    ["נתוני דוח זה מוכנים להפקת חשבונית", ""],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Set column widths
  ws["!cols"] = [{ wch: 30 }, { wch: 35 }];

  return ws;
}

// Create By Franchisee sheet
function createByFranchiseeSheet(
  byFranchisee: BrandFranchiseeCommission[]
): XLSX.WorkSheet {
  const headers = [
    "שם זכיין",
    "קוד זכיין",
    "מספר עמלות",
    "סכום ברוטו (₪)",
    "סכום נטו (₪)",
    "סכום עמלה (₪)",
    "שיעור עמלה ממוצע (%)",
  ];

  const data = byFranchisee.map((f) => [
    f.franchiseeName,
    f.franchiseeCode,
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
    { wch: 12 }, // Count
    { wch: 18 }, // Gross
    { wch: 18 }, // Net
    { wch: 18 }, // Commission
    { wch: 20 }, // Rate
  ];

  return ws;
}

// Create By Supplier sheet
function createBySupplierSheet(
  bySupplier: BrandSupplierCommission[]
): XLSX.WorkSheet {
  const headers = [
    "שם ספק",
    "קוד ספק",
    "מספר עמלות",
    "סכום ברוטו (₪)",
    "סכום נטו (₪)",
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
    { wch: 25 }, // Supplier name
    { wch: 12 }, // Code
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
  byPeriod: BrandCommissionPeriod[]
): XLSX.WorkSheet {
  const headers = [
    "תאריך התחלה",
    "תאריך סיום",
    "מספר עמלות",
    "סכום ברוטו (₪)",
    "סכום נטו (₪)",
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
    "שם ספק",
    "קוד ספק",
    "שם זכיין",
    "קוד זכיין",
    "תאריך התחלה",
    "תאריך סיום",
    "סכום ברוטו (₪)",
    "סכום נטו (₪)",
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
    { wch: 20 }, // Supplier name
    { wch: 10 }, // Supplier code
    { wch: 20 }, // Franchisee name
    { wch: 10 }, // Franchisee code
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

// Create Invoice-ready sheet (grouped for easy invoice generation)
function createInvoiceSheet(report: PerBrandReportData): XLSX.WorkSheet {
  const data = [
    ["נתונים להפקת חשבונית", "", "", "", ""],
    ["", "", "", "", ""],
    ["פרטי מותג", "", "", "", ""],
    ["שם מותג", report.brand.nameHe, "", "", ""],
    ["קוד מותג", report.brand.code, "", "", ""],
    ["אימייל", report.brand.contactEmail || "", "", "", ""],
    ["טלפון", report.brand.contactPhone || "", "", "", ""],
    ["", "", "", "", ""],
    ["תקופת חשבונית", "", "", "", ""],
    [
      "מתאריך",
      report.summary.periodRange.startDate
        ? formatDateHe(report.summary.periodRange.startDate)
        : "",
      "",
      "",
      "",
    ],
    [
      "עד תאריך",
      report.summary.periodRange.endDate
        ? formatDateHe(report.summary.periodRange.endDate)
        : "",
      "",
      "",
      "",
    ],
    ["", "", "", "", ""],
    ["סיכום לחשבונית", "", "", "", ""],
    ["", "", "", "", ""],
    ["פירוט", "כמות/סכום", "", "", ""],
    ["מספר זכיינים", report.summary.totalFranchisees, "", "", ""],
    ["מספר ספקים", report.summary.totalSuppliers, "", "", ""],
    ["מספר עמלות", report.summary.totalCommissions, "", "", ""],
    ["", "", "", "", ""],
    ["סכום ברוטו (₪)", formatCurrency(report.summary.totalGrossAmount), "", "", ""],
    ["סכום נטו (₪)", formatCurrency(report.summary.totalNetAmount), "", "", ""],
    ["", "", "", "", ""],
    ["סה״כ סכום עמלה לתשלום (₪)", formatCurrency(report.summary.totalCommissionAmount), "", "", ""],
    ["שיעור עמלה ממוצע (%)", formatPercent(report.summary.avgCommissionRate), "", "", ""],
    ["", "", "", "", ""],
    ["תאריך הפקת דוח", formatDateHe(report.summary.generatedAt), "", "", ""],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Set column widths
  ws["!cols"] = [{ wch: 30 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];

  return ws;
}

/**
 * GET /api/commissions/brand/[brandId]/export - Export per-brand commission report to Excel
 *
 * Query Parameters:
 * - startDate: ISO date string for period start (optional)
 * - endDate: ISO date string for period end (optional)
 * - supplierId: Filter by specific supplier (optional)
 * - status: Filter by commission status (optional)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ brandId: string }> }
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    // Only admins and super users can export commission reports
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { brandId } = await params;

    if (!brandId) {
      return NextResponse.json(
        { error: "Brand ID is required" },
        { status: 400 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const filters: PerBrandReportFilters = {
      brandId,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      supplierId: searchParams.get("supplierId") || undefined,
      status: searchParams.get("status") || undefined,
    };

    // Fetch report data
    const reportData = await getPerBrandReportData(filters);

    if (!reportData) {
      return NextResponse.json(
        { error: "Brand not found" },
        { status: 404 }
      );
    }

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Add sheets
    const summarySheet = createSummarySheet(reportData);
    XLSX.utils.book_append_sheet(wb, summarySheet, "סיכום");

    const invoiceSheet = createInvoiceSheet(reportData);
    XLSX.utils.book_append_sheet(wb, invoiceSheet, "נתונים לחשבונית");

    const byFranchiseeSheet = createByFranchiseeSheet(reportData.byFranchisee);
    XLSX.utils.book_append_sheet(wb, byFranchiseeSheet, "לפי זכיין");

    const bySupplierSheet = createBySupplierSheet(reportData.bySupplier);
    XLSX.utils.book_append_sheet(wb, bySupplierSheet, "לפי ספק");

    const byPeriodSheet = createByPeriodSheet(reportData.byPeriod);
    XLSX.utils.book_append_sheet(wb, byPeriodSheet, "לפי תקופה");

    const detailsSheet = createDetailsSheet(reportData.details);
    XLSX.utils.book_append_sheet(wb, detailsSheet, "פירוט מלא");

    // Generate buffer
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Generate filename with brand code and current date
    const today = new Date().toISOString().split("T")[0];
    const brandCode = reportData.brand.code.replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `brand_commission_report_${brandCode}_${today}.xlsx`;

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
    console.error("Error exporting per-brand commission report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
