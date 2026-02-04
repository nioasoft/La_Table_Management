import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { database } from "@/db";
import {
  supplierFileUpload,
  supplier,
  franchisee,
  brand,
  type SupplierFileProcessingResult,
} from "@/db/schema";
import { eq, and, gte, lte, inArray, isNotNull, or } from "drizzle-orm";
import * as XLSX from "xlsx";
import { formatDateAsLocal } from "@/lib/date-utils";

// ============================================================================
// TYPES
// ============================================================================

interface HashavshevetRow {
  accountKey: string; // מפתח חשבון
  accountName: string; // שם (ריק)
  itemKey: string; // מפתח פריט
  itemName: string; // שם פריט (ריק)
  quantity: number; // כמות
  price: number; // מחיר
  documentType: number; // סוג המסמך
  documentNumber: string; // מספר מסמך (ריק)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate commission for a franchisee match
 */
function calculateMatchCommission(
  match: SupplierFileProcessingResult["franchiseeMatches"][0],
  supplierCommissionRate: string | null,
  supplierCommissionType: string | null
): number {
  // Check for pre-calculated commission first
  if (match.preCalculatedCommission && match.preCalculatedCommission > 0) {
    return Math.trunc(match.preCalculatedCommission * 100) / 100;
  }

  // Calculate based on supplier rate
  if (!supplierCommissionRate) return 0;

  const rate = parseFloat(supplierCommissionRate);
  if (isNaN(rate)) return 0;

  let commission = 0;
  if (supplierCommissionType === "percentage") {
    commission = match.netAmount * (rate / 100);
  } else if (supplierCommissionType === "per_item") {
    commission = rate;
  }

  return Math.trunc(commission * 100) / 100;
}

// ============================================================================
// API HANDLER
// ============================================================================

/**
 * GET /api/reports/hashavshevet/export
 * Export Hashavshevet data to Excel
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const brandIdsParam = searchParams.get("brandIds");
    const supplierIdsParam = searchParams.get("supplierIds");
    const startDocNumber = parseInt(searchParams.get("startDocNumber") || "5001", 10);

    // Validate required parameters
    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "חובה לבחור תקופה (תאריך התחלה וסיום)" },
        { status: 400 }
      );
    }

    // Parse arrays
    const brandIds = brandIdsParam ? brandIdsParam.split(",").filter(Boolean) : [];
    const supplierIds = supplierIdsParam ? supplierIdsParam.split(",").filter(Boolean) : [];

    // Build conditions array
     
    const conditions: any[] = [
      or(
        eq(supplierFileUpload.processingStatus, "approved"),
        eq(supplierFileUpload.processingStatus, "auto_approved")
      ),
      isNotNull(supplier.hashavshevetCode),
      gte(supplierFileUpload.periodStartDate, startDate),
      lte(supplierFileUpload.periodEndDate, endDate),
    ];

    // Add supplier filter if specified
    if (supplierIds.length > 0) {
      conditions.push(inArray(supplier.id, supplierIds));
    }

    // Get files with supplier data
    const files = await database
      .select({
        fileId: supplierFileUpload.id,
        supplierId: supplier.id,
        supplierName: supplier.name,
        hashavshevetCode: supplier.hashavshevetCode,
        commissionRate: supplier.defaultCommissionRate,
        commissionType: supplier.commissionType,
        processingResult: supplierFileUpload.processingResult,
        periodStartDate: supplierFileUpload.periodStartDate,
        periodEndDate: supplierFileUpload.periodEndDate,
      })
      .from(supplierFileUpload)
      .innerJoin(supplier, eq(supplierFileUpload.supplierId, supplier.id))
      .where(and(...conditions));

    // Get franchisees and brands
    const [allFranchisees, allBrands] = await Promise.all([
      database
        .select({
          id: franchisee.id,
          name: franchisee.name,
          brandId: franchisee.brandId,
          hashavshevetItemKey: franchisee.hashavshevetItemKey,
        })
        .from(franchisee),
      database
        .select({
          id: brand.id,
          nameHe: brand.nameHe,
        })
        .from(brand),
    ]);

    const franchiseeMap = new Map(allFranchisees.map((f) => [f.id, f]));
    const brandMap = new Map(allBrands.map((b) => [b.id, b]));

    // Build rows for Hashavshevet format
    const rows: HashavshevetRow[] = [];
    let currentDocNumber = startDocNumber;

    for (const file of files) {
      if (!file.processingResult || !file.hashavshevetCode) continue;

      const processingResult = file.processingResult as SupplierFileProcessingResult;
      if (!processingResult.franchiseeMatches) continue;

      for (const match of processingResult.franchiseeMatches) {
        if (!match.matchedFranchiseeId || match.matchType === "blacklisted" || match.matchType === "none") {
          continue;
        }

        const franchiseeInfo = franchiseeMap.get(match.matchedFranchiseeId);
        if (!franchiseeInfo) continue;

        if (brandIds.length > 0 && !brandIds.includes(franchiseeInfo.brandId)) {
          continue;
        }

        const brandInfo = brandMap.get(franchiseeInfo.brandId);
        if (!brandInfo) continue;

        const commissionAmount = calculateMatchCommission(
          match,
          file.commissionRate,
          file.commissionType
        );

        if (commissionAmount === 0) continue;

        rows.push({
          accountKey: file.hashavshevetCode,
          accountName: "", // Empty as per spec
          itemKey: franchiseeInfo.hashavshevetItemKey || `עמלות ${franchiseeInfo.name}`,
          itemName: "", // Empty as per spec
          quantity: 1,
          price: commissionAmount,
          documentType: 11,
          documentNumber: String(currentDocNumber),
        });
        currentDocNumber++;
      }
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "אין נתונים לייצוא" },
        { status: 400 }
      );
    }

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Create data array with headers
    const headers = [
      "מפתח חשבון",
      "שם",
      "מפתח פריט",
      "שם פריט",
      "כמות",
      "מחיר",
      "סוג המסמך",
      "מספר מסמך",
    ];

    const data = [
      headers,
      ...rows.map((row) => [
        row.accountKey,
        row.accountName,
        row.itemKey,
        row.itemName,
        row.quantity,
        row.price,
        row.documentType,
        row.documentNumber,
      ]),
    ];

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set numeric columns to number type with explicit number format
    // E = כמות (quantity), F = מחיר (price), G = סוג המסמך (documentType)
    // columns: [index, format] - format is Excel number format string
    const numericColumns: [number, string][] = [
      [4, "0"],        // כמות - integer
      [5, "#,##0.00"], // מחיר - decimal with 2 places
      [6, "0"],        // סוג המסמך - integer
    ];
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");

    for (let row = 1; row <= range.e.r; row++) {
      // Skip header row (row 0)
      for (const [col, format] of numericColumns) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = ws[cellAddress];
        if (cell && cell.v !== undefined && cell.v !== "") {
          cell.t = "n"; // Set type to number
          cell.z = format; // Set number format
        }
      }
    }

    // Set column widths
    ws["!cols"] = [
      { wch: 15 }, // מפתח חשבון
      { wch: 10 }, // שם
      { wch: 35 }, // מפתח פריט
      { wch: 10 }, // שם פריט
      { wch: 8 }, // כמות
      { wch: 12 }, // מחיר
      { wch: 12 }, // סוג המסמך
      { wch: 12 }, // מספר מסמך
    ];

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, "ייבוא חשבשבת");

    // Add named range "חוזים" covering all data (including header)
    // This is required for Hashavshevet to recognize the data during import
    if (!wb.Workbook) wb.Workbook = {};
    if (!wb.Workbook.Names) wb.Workbook.Names = [];

    const lastRow = rows.length + 1; // +1 for header row
    wb.Workbook.Names.push({
      Name: "חוזים",
      Ref: `'ייבוא חשבשבת'!$A$1:$H$${lastRow}`,
    });

    // Generate buffer
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Generate filename based on selected brand
    let filename: string;
    if (brandIds.length === 1) {
      const selectedBrand = brandMap.get(brandIds[0]);
      if (selectedBrand) {
        // For system brand "שונות", don't add "רשת"
        if (selectedBrand.nameHe === "שונות") {
          filename = `עמלות שונות.xlsx`;
        } else {
          filename = `עמלות רשת ${selectedBrand.nameHe}.xlsx`;
        }
      } else {
        filename = `hashavshevet_export.xlsx`;
      }
    } else {
      filename = `hashavshevet_export.xlsx`;
    }

    // Return Excel file
    // Encode filename for Content-Disposition header (RFC 5987 for non-ASCII)
    const encodedFilename = encodeURIComponent(filename);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}`,
      },
    });
  } catch (error) {
    console.error("Error exporting hashavshevet report:", error);
    return NextResponse.json(
      { error: "שגיאה בייצוא הקובץ" },
      { status: 500 }
    );
  }
}
