import { NextRequest, NextResponse } from "next/server";
import {
  requireSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import * as XLSX from "xlsx";
import {
  getCommissionsGroupedByBrand,
  type CommissionInvoiceData,
  type CommissionBrandGroup,
  type CommissionWithDetails,
} from "@/data-access/commissions";
import { type CommissionStatus } from "@/db/schema";
import { formatDateAsLocal } from "@/lib/date-utils";

// Format currency for Excel (number format)
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

// Status translation map
const statusMap: Record<string, string> = {
  pending: "ממתין",
  calculated: "חושב",
  approved: "מאושר",
  paid: "שולם",
  cancelled: "בוטל",
};

/**
 * Create Summary sheet for the invoice report
 * Contains supplier info, period, and overall totals
 */
function createInvoiceSummarySheet(data: CommissionInvoiceData): XLSX.WorkSheet {
  const rows = [
    [`דוח חשבוניות לספק: ${data.supplierName}`, ""],
    ["", ""],
    ["פרטי ספק", ""],
    ["קוד ספק", data.supplierCode],
    ["שם ספק", data.supplierName],
    ["", ""],
    ["תקופת הדוח", ""],
    ["תאריך התחלה", formatDateHe(data.periodStartDate)],
    ["תאריך סיום", formatDateHe(data.periodEndDate)],
    ["תאריך הפקה", formatDateHe(data.generatedAt)],
    ["", ""],
    ["סיכום כללי", ""],
    ["מספר מותגים", data.totals.totalBrands],
    ["סה״כ עמלות", data.totals.totalCommissions],
    ["סה״כ סכום כולל מע״מ (₪)", formatCurrency(data.totals.totalGrossAmount)],
    ["סה״כ סכום לפני מע״מ (₪)", formatCurrency(data.totals.totalNetAmount)],
    ["סה״כ סכום עמלה (₪)", formatCurrency(data.totals.totalCommissionAmount)],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 25 }, { wch: 30 }];

  return ws;
}

/**
 * Create By Brand Summary sheet
 * Shows all brands with their totals - useful for quick overview
 */
function createByBrandSummarySheet(byBrand: CommissionBrandGroup[]): XLSX.WorkSheet {
  const headers = [
    "קוד מותג",
    "שם מותג",
    "מספר עמלות",
    "סכום כולל מע״מ (₪)",
    "סכום לפני מע״מ (₪)",
    "סכום עמלה (₪)",
    "שיעור עמלה ממוצע (%)",
  ];

  const data = byBrand.map((brand) => [
    brand.brandCode,
    brand.brandNameHe,
    brand.summary.commissionCount,
    formatCurrency(brand.summary.totalGrossAmount),
    formatCurrency(brand.summary.totalNetAmount),
    formatCurrency(brand.summary.totalCommissionAmount),
    formatPercent(brand.summary.avgCommissionRate),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws["!cols"] = [
    { wch: 12 }, // Brand code
    { wch: 25 }, // Brand name
    { wch: 12 }, // Count
    { wch: 18 }, // Gross
    { wch: 18 }, // Net
    { wch: 18 }, // Commission
    { wch: 20 }, // Rate
  ];

  return ws;
}

/**
 * Create a sheet for a single brand's invoice details
 * This is the main invoice data per brand
 */
function createBrandInvoiceSheet(brand: CommissionBrandGroup): XLSX.WorkSheet {
  // Brand header info
  const headerRows = [
    [`חשבונית למותג: ${brand.brandNameHe}`, ""],
    ["קוד מותג", brand.brandCode],
    ["", ""],
    ["סיכום", ""],
    ["מספר עמלות", brand.summary.commissionCount],
    ["סכום כולל מע״מ (₪)", formatCurrency(brand.summary.totalGrossAmount)],
    ["סכום לפני מע״מ (₪)", formatCurrency(brand.summary.totalNetAmount)],
    ["סכום עמלה (₪)", formatCurrency(brand.summary.totalCommissionAmount)],
    ["", ""],
    ["פירוט עמלות:", ""],
  ];

  // Commission details headers
  const detailHeaders = [
    "שם זכיין",
    "קוד זכיין",
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
  ];

  const detailData = brand.commissions.map((c) => [
    c.franchiseeName,
    c.franchiseeCode,
    formatDateHe(c.periodStartDate),
    formatDateHe(c.periodEndDate),
    formatCurrency(Number(c.grossAmount || 0)),
    formatCurrency(Number(c.netAmount || 0)),
    formatPercent(Number(c.commissionRate || 0)),
    formatCurrency(Number(c.commissionAmount || 0)),
    statusMap[c.status] || c.status,
    c.invoiceNumber || "",
    c.invoiceDate ? formatDateHe(c.invoiceDate) : "",
    c.notes || "",
  ]);

  // Combine header rows with detail table
  const allRows = [
    ...headerRows,
    detailHeaders,
    ...detailData,
  ];

  const ws = XLSX.utils.aoa_to_sheet(allRows);

  // Set column widths
  ws["!cols"] = [
    { wch: 25 }, // Franchisee name
    { wch: 12 }, // Franchisee code
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
  ];

  return ws;
}

/**
 * Create All Details sheet
 * Contains all commission details across all brands
 */
function createAllDetailsSheet(byBrand: CommissionBrandGroup[]): XLSX.WorkSheet {
  const headers = [
    "מותג",
    "קוד מותג",
    "שם זכיין",
    "קוד זכיין",
    "תאריך התחלה",
    "תאריך סיום",
    "סכום כולל מע״מ (₪)",
    "סכום לפני מע״מ (₪)",
    "שיעור עמלה (%)",
    "סכום עמלה (₪)",
    "סטטוס",
    "מס׳ חשבונית",
    "תאריך חשבונית",
    "מזהה עמלה",
  ];

  // Flatten all commissions across all brands
  const allCommissions: (string | number)[][] = [];
  for (const brand of byBrand) {
    for (const c of brand.commissions) {
      allCommissions.push([
        brand.brandNameHe,
        brand.brandCode,
        c.franchiseeName,
        c.franchiseeCode,
        formatDateHe(c.periodStartDate),
        formatDateHe(c.periodEndDate),
        formatCurrency(Number(c.grossAmount || 0)),
        formatCurrency(Number(c.netAmount || 0)),
        formatPercent(Number(c.commissionRate || 0)),
        formatCurrency(Number(c.commissionAmount || 0)),
        statusMap[c.status] || c.status,
        c.invoiceNumber || "",
        c.invoiceDate ? formatDateHe(c.invoiceDate) : "",
        c.id,
      ]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet([headers, ...allCommissions]);

  ws["!cols"] = [
    { wch: 20 }, // Brand name
    { wch: 12 }, // Brand code
    { wch: 25 }, // Franchisee name
    { wch: 12 }, // Franchisee code
    { wch: 12 }, // Start date
    { wch: 12 }, // End date
    { wch: 15 }, // Gross
    { wch: 15 }, // Net
    { wch: 12 }, // Rate
    { wch: 15 }, // Commission
    { wch: 10 }, // Status
    { wch: 15 }, // Invoice number
    { wch: 12 }, // Invoice date
    { wch: 36 }, // ID
  ];

  return ws;
}

/**
 * Create Hashavshevet Preparation sheet
 * This is a placeholder format that can be adapted for future Hashavshevet integration
 * Contains structured data in a format that can be easily converted
 */
function createHashavshevetPrepSheet(
  data: CommissionInvoiceData,
  byBrand: CommissionBrandGroup[]
): XLSX.WorkSheet {
  // Header explaining the sheet
  const headerInfo = [
    ["גיליון הכנה לחשבשבת", ""],
    ["הערה: גיליון זה מכיל נתונים מובנים להעברה עתידית לחשבשבת", ""],
    ["", ""],
  ];

  // Structured data for each brand invoice
  const headers = [
    "מזהה_ספק",
    "קוד_ספק",
    "שם_ספק",
    "מזהה_מותג",
    "קוד_מותג",
    "שם_מותג",
    "תאריך_התחלה",
    "תאריך_סיום",
    "סכום_כולל_מעמ",
    "סכום_לפני_מעמ",
    "סכום_עמלה",
    "מספר_עמלות",
    "שיעור_עמלה_ממוצע",
  ];

  const brandData = byBrand.map((brand) => [
    data.supplierId,
    data.supplierCode,
    data.supplierName,
    brand.brandId,
    brand.brandCode,
    brand.brandNameHe,
    data.periodStartDate,
    data.periodEndDate,
    brand.summary.totalGrossAmount,
    brand.summary.totalNetAmount,
    brand.summary.totalCommissionAmount,
    brand.summary.commissionCount,
    brand.summary.avgCommissionRate,
  ]);

  const allRows = [...headerInfo, headers, ...brandData];
  const ws = XLSX.utils.aoa_to_sheet(allRows);

  ws["!cols"] = [
    { wch: 36 }, // Supplier ID
    { wch: 12 }, // Supplier code
    { wch: 25 }, // Supplier name
    { wch: 36 }, // Brand ID
    { wch: 12 }, // Brand code
    { wch: 25 }, // Brand name
    { wch: 12 }, // Start date
    { wch: 12 }, // End date
    { wch: 15 }, // Gross
    { wch: 15 }, // Net
    { wch: 15 }, // Commission
    { wch: 12 }, // Count
    { wch: 15 }, // Rate
  ];

  return ws;
}

/**
 * Sanitize sheet name for Excel compatibility
 * Excel sheet names have restrictions (max 31 chars, no special characters)
 */
function sanitizeSheetName(name: string): string {
  // Remove characters that Excel doesn't allow in sheet names
  let sanitized = name.replace(/[\\/*?:\[\]]/g, "");
  // Truncate to 31 characters (Excel limit)
  if (sanitized.length > 31) {
    sanitized = sanitized.substring(0, 28) + "...";
  }
  return sanitized || "Sheet";
}

/**
 * GET /api/commissions/invoice/export - Export invoice reports to Excel
 * Generates one report per brand per supplier
 *
 * Query Parameters:
 * - supplierId: (required) Supplier ID
 * - periodStartDate: (required) Period start date (YYYY-MM-DD)
 * - periodEndDate: (required) Period end date (YYYY-MM-DD)
 * - status: (optional) Filter by status (approved is recommended for invoicing)
 * - format: (optional) Export format - 'xlsx' (default) or 'hashavshevet' (placeholder for future)
 *
 * Returns Excel file with:
 * - Summary sheet with supplier and totals
 * - By Brand summary sheet
 * - Individual sheets for each brand's invoice details
 * - All Details sheet with every commission
 * - Hashavshevet Prep sheet for future integration
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const supplierId = searchParams.get("supplierId");
    const periodStartDate = searchParams.get("periodStartDate");
    const periodEndDate = searchParams.get("periodEndDate");
    const status = searchParams.get("status") as CommissionStatus | null;
    const format = searchParams.get("format") || "xlsx";

    // Validate required parameters
    if (!supplierId) {
      return NextResponse.json(
        { error: "supplierId is required" },
        { status: 400 }
      );
    }

    if (!periodStartDate || !periodEndDate) {
      return NextResponse.json(
        { error: "periodStartDate and periodEndDate are required" },
        { status: 400 }
      );
    }

    // Fetch invoice data grouped by brand
    const invoiceData = await getCommissionsGroupedByBrand(
      supplierId,
      periodStartDate,
      periodEndDate,
      status || undefined
    );

    if (!invoiceData) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      );
    }

    if (invoiceData.byBrand.length === 0) {
      return NextResponse.json(
        { error: "No commissions found for the specified period and filters" },
        { status: 404 }
      );
    }

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Add Summary sheet
    const summarySheet = createInvoiceSummarySheet(invoiceData);
    XLSX.utils.book_append_sheet(wb, summarySheet, "סיכום");

    // Add By Brand Summary sheet
    const byBrandSheet = createByBrandSummarySheet(invoiceData.byBrand);
    XLSX.utils.book_append_sheet(wb, byBrandSheet, "סיכום לפי מותג");

    // Add individual brand invoice sheets
    for (const brand of invoiceData.byBrand) {
      const brandSheet = createBrandInvoiceSheet(brand);
      const sheetName = sanitizeSheetName(`חשבונית - ${brand.brandNameHe}`);
      XLSX.utils.book_append_sheet(wb, brandSheet, sheetName);
    }

    // Add All Details sheet
    const allDetailsSheet = createAllDetailsSheet(invoiceData.byBrand);
    XLSX.utils.book_append_sheet(wb, allDetailsSheet, "פירוט מלא");

    // Add Hashavshevet Prep sheet (for future integration)
    const hashavshvetSheet = createHashavshevetPrepSheet(
      invoiceData,
      invoiceData.byBrand
    );
    XLSX.utils.book_append_sheet(wb, hashavshvetSheet, "הכנה לחשבשבת");

    // Generate buffer
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Generate filename
    const today = formatDateAsLocal(new Date());
    const supplierCode = invoiceData.supplierCode.replace(/[^a-zA-Z0-9]/g, "_");
    const periodStr = `${periodStartDate}_to_${periodEndDate}`.replace(/-/g, "");
    const filename = `invoice_report_${supplierCode}_${periodStr}_${today}.xlsx`;

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
    console.error("Error exporting invoice report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
