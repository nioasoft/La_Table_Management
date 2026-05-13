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
  reconciliationComparison,
  type SupplierFileProcessingResult,
} from "@/db/schema";
import { eq, and, gte, lte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { hasCommissionFromFile } from "@/lib/custom-parsers/suppliers-with-file-commission";
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
  supplierCommissionType: string | null,
  supplierCode?: string
): number {
  const isFileCommission = supplierCode ? hasCommissionFromFile(supplierCode) : false;
  // File-commission suppliers: always use file value (even 0 = no commission)
  // Other suppliers: only use positive pre-calculated values
  if (match.preCalculatedCommission != null && (isFileCommission || match.preCalculatedCommission > 0)) {
    return Math.round(match.preCalculatedCommission);
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

  return Math.round(commission);
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
    // Mirror /api/reports/hashavshevet: default ON. Filters out rows whose
    // latest non-archived reconciliation comparison wasn't approved.
    const onlyApproved = searchParams.get("onlyApproved") !== "false";

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
      // Period overlap (mirrors /api/reports/hashavshevet)
      lte(supplierFileUpload.periodStartDate, endDate),
      gte(supplierFileUpload.periodEndDate, startDate),
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
        supplierCode: supplier.code,
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

    // Same approval gate as /api/reports/hashavshevet — keeps preview and
    // Excel in sync. Empty when the flag is off.
    const approvedSet = new Set<string>();
    if (onlyApproved) {
      const freshSessions = await database.execute<{
        id: string;
        supplier_id: string;
        period_start_date: string;
        period_end_date: string;
      }>(sql`
        SELECT DISTINCT ON (supplier_id, period_start_date, period_end_date)
          id, supplier_id, period_start_date, period_end_date
        FROM reconciliation_session
        WHERE archived_at IS NULL
          AND period_start_date <= ${endDate}
          AND period_end_date >= ${startDate}
        ORDER BY supplier_id, period_start_date, period_end_date, created_at DESC
      `);

      const sessionContext = new Map<
        string,
        { supplierId: string; periodStart: string; periodEnd: string }
      >();
      for (const row of freshSessions.rows) {
        sessionContext.set(row.id, {
          supplierId: row.supplier_id,
          periodStart: row.period_start_date,
          periodEnd: row.period_end_date,
        });
      }

      if (sessionContext.size > 0) {
        const approvedRows = await database
          .select({
            sessionId: reconciliationComparison.sessionId,
            franchiseeId: reconciliationComparison.franchiseeId,
          })
          .from(reconciliationComparison)
          .where(
            and(
              inArray(reconciliationComparison.sessionId, [
                ...sessionContext.keys(),
              ]),
              inArray(reconciliationComparison.status, [
                "auto_approved",
                "manually_approved",
              ])
            )
          );

        for (const r of approvedRows) {
          const ctx = sessionContext.get(r.sessionId);
          if (!ctx) continue;
          approvedSet.add(
            `${ctx.supplierId}|${r.franchiseeId}|${ctx.periodStart}|${ctx.periodEnd}`
          );
        }
      }
    }

    // Build rows for Hashavshevet format.
    //
    // Aggregation: per-invoice parsers (e.g. שרי שוקו) produce one franchisee
    // match per invoice. The Hashavshevet sheet should hold one line per
    // (supplier × franchisee × period) — same logic as /api/reports/hashavshevet
    // for the on-screen report. Reconciliation-v2 keeps the underlying detail.
    const aggregated = new Map<
      string,
      Omit<HashavshevetRow, "documentNumber"> & { price: number }
    >();

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
          file.commissionType,
          file.supplierCode
        );

        if (commissionAmount === 0) continue;

        // Reconciliation gate (same key shape as /api/reports/hashavshevet)
        if (onlyApproved) {
          const key = `${file.supplierId}|${match.matchedFranchiseeId}|${file.periodStartDate}|${file.periodEndDate}`;
          if (!approvedSet.has(key)) continue;
        }

        const aggKey = `${file.supplierId}|${match.matchedFranchiseeId}|${file.periodStartDate}|${file.periodEndDate}`;
        const existing = aggregated.get(aggKey);
        if (existing) {
          existing.price += commissionAmount;
        } else {
          aggregated.set(aggKey, {
            accountKey: file.hashavshevetCode,
            accountName: "",
            itemKey: franchiseeInfo.hashavshevetItemKey || `עמלות ${franchiseeInfo.name}`,
            itemName: "",
            quantity: 1,
            price: commissionAmount,
            documentType: 11,
          });
        }
      }
    }

    // Assign running document numbers after aggregation so identical-supplier
    // lines get consecutive numbers (Reut prefers this; matches the on-screen
    // preview at /admin/reports/hashavshevet).
    let currentDocNumber = startDocNumber;
    const rows: HashavshevetRow[] = Array.from(aggregated.values()).map((r) => ({
      ...r,
      documentNumber: String(currentDocNumber++),
    }));

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
      filename = `עמלות כל הרשתות.xlsx`;
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
