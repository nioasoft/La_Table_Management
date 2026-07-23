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
import { eq, and, gte, lte, inArray, or, sql } from "drizzle-orm";
import { hasCommissionFromFile } from "@/lib/custom-parsers/suppliers-with-file-commission";
import { fileBelongsInExportRange } from "@/lib/settlement-periods";
import * as XLSX from "xlsx";
import AdmZip from "adm-zip";
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

/**
 * Excel filename for a single brand's Hashavshevet export.
 * System brand "שונות" drops the "רשת" prefix (matches legacy naming).
 */
function brandExcelFileName(brandNameHe: string): string {
  return brandNameHe === "שונות"
    ? `עמלות שונות.xlsx`
    : `עמלות רשת ${brandNameHe}.xlsx`;
}

/**
 * Build a Hashavshevet import workbook from already-numbered rows and return it
 * as an xlsx buffer. Includes the named range "חוזים" that Hashavshevet requires
 * to recognize the data on import — every file must carry its own range, which
 * is why "all networks" splits into separate files rather than one multi-sheet
 * workbook.
 */
function buildHashavshevetWorkbookBuffer(rows: HashavshevetRow[]): Buffer {
  const wb = XLSX.utils.book_new();

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

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Set numeric columns to number type with explicit number format
  // E = כמות (quantity), F = מחיר (price), G = סוג המסמך (documentType)
  const numericColumns: [number, string][] = [
    [4, "0"], // כמות - integer
    [5, "#,##0.00"], // מחיר - decimal with 2 places
    [6, "0"], // סוג המסמך - integer
  ];
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");

  for (let row = 1; row <= range.e.r; row++) {
    for (const [col, format] of numericColumns) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = ws[cellAddress];
      if (cell && cell.v !== undefined && cell.v !== "") {
        cell.t = "n";
        cell.z = format;
      }
    }
  }

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

  XLSX.utils.book_append_sheet(wb, ws, "ייבוא חשבשבת");

  // Named range "חוזים" covering all data including the header — required for
  // Hashavshevet to recognize the data during import.
  if (!wb.Workbook) wb.Workbook = {};
  if (!wb.Workbook.Names) wb.Workbook.Names = [];
  const lastRow = rows.length + 1; // +1 for header row
  wb.Workbook.Names.push({
    Name: "חוזים",
    Ref: `'ייבוא חשבשבת'!$A$1:$H$${lastRow}`,
  });

  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
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
        settlementFrequency: supplier.settlementFrequency,
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
      Omit<HashavshevetRow, "documentNumber"> & {
        price: number;
        brandId: string;
        brandNameHe: string;
      }
    >();
    // Suppliers that have commissions in this period but no hashavshevetCode.
    // We block the XLSX download until Reut configures them, instead of
    // silently dropping the supplier from the export.
    const missingHashavshevetMap = new Map<
      string,
      { id: string; name: string; code: string | null }
    >();

    for (const file of files) {
      if (!file.processingResult) continue;

      // Frequency gate: monthly suppliers appear in monthly runs; multi-month
      // runs take only their last-month file (earlier months already billed).
      if (
        !fileBelongsInExportRange(
          file.settlementFrequency,
          file.periodStartDate,
          startDate,
          endDate
        )
      ) {
        continue;
      }

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

        // Supplier has commissions in this period but no hashavshevetCode —
        // record and skip; we block the export below until Reut fixes it.
        if (!file.hashavshevetCode) {
          if (!missingHashavshevetMap.has(file.supplierId)) {
            missingHashavshevetMap.set(file.supplierId, {
              id: file.supplierId,
              name: file.supplierName,
              code: file.supplierCode,
            });
          }
          continue;
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
            brandId: franchiseeInfo.brandId,
            brandNameHe: brandInfo.nameHe,
          });
        }
      }
    }

    // Block the XLSX download if any supplier in the result is missing its
    // hashavshevetCode. Reut must configure them via /admin/suppliers/[id]
    // before the export can produce a complete file. UI parses this 400
    // response and renders the list to the user.
    if (missingHashavshevetMap.size > 0) {
      return NextResponse.json(
        {
          error: "לא ניתן לייצא — יש ספקים ללא כרטיס חשבשבת",
          missingSuppliers: Array.from(missingHashavshevetMap.values()).sort(
            (a, b) => a.name.localeCompare(b.name, "he")
          ),
        },
        { status: 400 }
      );
    }

    const aggregatedRows = Array.from(aggregated.values());

    if (aggregatedRows.length === 0) {
      return NextResponse.json(
        { error: "אין נתונים לייצוא" },
        { status: 400 }
      );
    }

    // Number a group of aggregated rows from startDocNumber. Each network file
    // restarts its own numbering (matches Reut's manual per-network exports).
    const numberRows = (
      group: typeof aggregatedRows
    ): HashavshevetRow[] => {
      let doc = startDocNumber;
      return group.map((r) => ({
        accountKey: r.accountKey,
        accountName: r.accountName,
        itemKey: r.itemKey,
        itemName: r.itemName,
        quantity: r.quantity,
        price: r.price,
        documentType: r.documentType,
        documentNumber: String(doc++),
      }));
    };

    // "All networks" (no brand filter) → ZIP with a separate Excel per network,
    // so each file imports into Hashavshevet on its own. A specific brand keeps
    // the single-file behavior.
    if (brandIds.length === 0) {
      const byBrand = new Map<string, typeof aggregatedRows>();
      const brandNames = new Map<string, string>();
      for (const r of aggregatedRows) {
        brandNames.set(r.brandId, r.brandNameHe);
        const group = byBrand.get(r.brandId);
        if (group) group.push(r);
        else byBrand.set(r.brandId, [r]);
      }

      const zip = new AdmZip();
      for (const [brandId, group] of byBrand) {
        const buffer = buildHashavshevetWorkbookBuffer(numberRows(group));
        zip.addFile(
          brandExcelFileName(brandNames.get(brandId) || "שונות"),
          buffer
        );
      }

      const zipBuffer = zip.toBuffer();
      const encodedFilename = encodeURIComponent("עמלות לפי רשת.zip");
      return new NextResponse(new Uint8Array(zipBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}`,
        },
      });
    }

    // Single (or explicit) brand → one Excel file (legacy behavior).
    const buffer = buildHashavshevetWorkbookBuffer(numberRows(aggregatedRows));

    let filename: string;
    if (brandIds.length === 1) {
      const selectedBrand = brandMap.get(brandIds[0]);
      filename = selectedBrand
        ? brandExcelFileName(selectedBrand.nameHe)
        : `hashavshevet_export.xlsx`;
    } else {
      filename = `עמלות כל הרשתות.xlsx`;
    }

    // Encode filename for Content-Disposition header (RFC 5987 for non-ASCII)
    const encodedFilename = encodeURIComponent(filename);
    return new NextResponse(new Uint8Array(buffer), {
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
