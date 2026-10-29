import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  buildSupplierCommissionsSheets,
  loadSupplierCommissionsData,
  MISSING_CODE_MESSAGE,
  SUPPLIER_COMMISSIONS_HEADERS,
  type SupplierCommissionBrand,
  type SupplierCommissionsParams,
  type SupplierCommissionsSheet,
} from "@/lib/hashavshevet/builders/supplier-commissions";
import type { BuiltRow } from "@/lib/hashavshevet/types";
import * as XLSX from "xlsx";
import AdmZip from "adm-zip";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Excel filename for a single brand's Hashavshevet export.
 * System brand "שונות" drops the "רשת" prefix (matches legacy naming).
 */
function brandExcelFileName(brandNameHe: string): string {
  return brandNameHe === "שונות"
    ? `עמלות שונות.xlsx`
    : `עמלות רשת ${brandNameHe}.xlsx`;
}

/** Column widths: מפתח חשבון, שם, מפתח פריט, שם פריט, כמות, מחיר, סוג המסמך, מספר מסמך. */
const COLUMN_WIDTHS = [15, 10, 35, 10, 8, 12, 12, 12];

/**
 * Build a Hashavshevet import workbook from already-numbered rows and return it
 * as an xlsx buffer. Includes the named range "חוזים" that Hashavshevet requires
 * to recognize the data on import — every file must carry its own range, which
 * is why "all networks" splits into separate files rather than one multi-sheet
 * workbook.
 */
function buildHashavshevetWorkbookBuffer(rows: BuiltRow[]): Buffer {
  const wb = XLSX.utils.book_new();

  const headers = SUPPLIER_COMMISSIONS_HEADERS;
  const data = [
    [...headers],
    ...rows.map((row) => headers.map((header) => row.display[header])),
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

  ws["!cols"] = COLUMN_WIDTHS.map((wch) => ({ wch }));

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

function fileResponse(buffer: Buffer, filename: string, contentType: string): NextResponse {
  // Encode filename for Content-Disposition header (RFC 5987 for non-ASCII)
  const encodedFilename = encodeURIComponent(filename);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}`,
    },
  });
}

/** Query params → loader params; null when the period is missing. */
function parseQuery(request: NextRequest): SupplierCommissionsParams | null {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const brandIdsParam = searchParams.get("brandIds");
  const supplierIdsParam = searchParams.get("supplierIds");
  const startDocNumber = parseInt(searchParams.get("startDocNumber") || "5001", 10);
  // Mirror /api/reports/hashavshevet: default ON. Filters out rows whose
  // latest non-archived reconciliation comparison wasn't approved.
  const onlyApproved = searchParams.get("onlyApproved") !== "false";
  if (!startDate || !endDate) return null;

  const brandIds = brandIdsParam ? brandIdsParam.split(",").filter(Boolean) : [];
  const supplierIds = supplierIdsParam ? supplierIdsParam.split(",").filter(Boolean) : [];
  return { startDate, endDate, brandIds, supplierIds, startDocNumber, onlyApproved };
}

/**
 * "All networks" (no brand filter) → ZIP with a separate Excel per network, so
 * each file imports into Hashavshevet on its own. A specific brand (or several)
 * keeps the single-file behavior.
 */
function exportFiles(
  sheets: SupplierCommissionsSheet[],
  brandIds: string[],
  brands: SupplierCommissionBrand[]
): NextResponse {
  if (brandIds.length === 0) {
    const zip = new AdmZip();
    for (const sheet of sheets) {
      zip.addFile(
        brandExcelFileName(sheet.brandNameHe || "שונות"),
        buildHashavshevetWorkbookBuffer(sheet.rows)
      );
    }
    return fileResponse(zip.toBuffer(), "עמלות לפי רשת.zip", "application/zip");
  }

  let filename = `עמלות כל הרשתות.xlsx`;
  if (brandIds.length === 1) {
    const selectedBrand = brands.find((b) => b.id === brandIds[0]);
    filename = selectedBrand
      ? brandExcelFileName(selectedBrand.nameHe)
      : `hashavshevet_export.xlsx`;
  }
  return fileResponse(
    buildHashavshevetWorkbookBuffer(sheets[0].rows),
    filename,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

/**
 * GET /api/reports/hashavshevet/export
 * Export Hashavshevet data to Excel
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const params = parseQuery(request);
    if (!params) {
      return NextResponse.json(
        { error: "חובה לבחור תקופה (תאריך התחלה וסיום)" },
        { status: 400 }
      );
    }

    const data = await loadSupplierCommissionsData(params);
    const { sheets, missingSuppliers } = buildSupplierCommissionsSheets(data);

    // Block the XLSX download if any supplier in the result is missing its
    // hashavshevetCode. Reut must configure them via /admin/suppliers/[id]
    // before the export can produce a complete file. UI parses this 400
    // response and renders the list to the user.
    if (missingSuppliers.length > 0) {
      return NextResponse.json(
        { error: MISSING_CODE_MESSAGE, missingSuppliers },
        { status: 400 }
      );
    }
    if (sheets.length === 0) {
      return NextResponse.json({ error: "אין נתונים לייצוא" }, { status: 400 });
    }
    return exportFiles(sheets, params.brandIds, data.brands);
  } catch (error) {
    console.error("Error exporting hashavshevet report:", error);
    return NextResponse.json(
      { error: "שגיאה בייצוא הקובץ" },
      { status: 500 }
    );
  }
}
