/**
 * Tabit POS report parser
 *
 * Parses Excel files from Tabit POS system containing transaction data
 * per franchisee for a given period.
 *
 * NOTE: This is a scaffold parser. The actual column mapping and extraction
 * logic will be refined once real Tabit sample files are provided.
 */

import * as XLSX from "xlsx";
import type { ClientDocumentProcessingResult, ClientParsedLineItem } from "./types";

/**
 * Parse a Tabit POS Excel report
 */
export async function parseTabitFile(
  buffer: Buffer,
  mimeType: string
): Promise<ClientDocumentProcessingResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Validate mime type
    const excelMimeTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
      "application/octet-stream",
    ];

    if (!excelMimeTypes.includes(mimeType) && !mimeType.includes("excel") && !mimeType.includes("spreadsheet")) {
      errors.push(`סוג קובץ לא נתמך: ${mimeType}. נדרש קובץ Excel.`);
      return { success: false, data: null, errors, warnings };
    }

    const workbook = XLSX.read(buffer, { type: "buffer" });

    if (!workbook.SheetNames.length) {
      errors.push("קובץ Excel ריק - אין גיליונות");
      return { success: false, data: null, errors, warnings };
    }

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
    });

    if (rows.length === 0) {
      errors.push("גיליון ריק - אין נתונים");
      return { success: false, data: null, errors, warnings };
    }

    // TODO: Implement actual Tabit column mapping when sample file is provided
    // For now, return a scaffold that extracts basic info from first row headers
    const headers = Object.keys(rows[0]);
    warnings.push(
      `פרסר טאביט בשלב פיתוח. נמצאו ${rows.length} שורות עם ${headers.length} עמודות: ${headers.slice(0, 5).join(", ")}...`
    );

    // Attempt to extract total amount from common column names
    let totalAmount = 0;
    let franchiseeName = "";
    const lineItems: ClientParsedLineItem[] = [];

    // Look for common Hebrew column headers
    const amountHeaders = ["סכום", "סה\"כ", "סהכ", "total", "amount", "סך הכל"];
    const nameHeaders = ["שם", "סניף", "זכיין", "franchisee", "name", "branch"];

    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        const lowerKey = key.toLowerCase();

        // Try to find total amount
        if (amountHeaders.some((h) => lowerKey.includes(h)) && typeof value === "number") {
          totalAmount += value;
        }

        // Try to find franchisee name (from first row)
        if (!franchiseeName && nameHeaders.some((h) => lowerKey.includes(h)) && typeof value === "string" && value.trim()) {
          franchiseeName = value.trim();
        }
      }
    }

    return {
      success: true,
      data: {
        franchiseeName: franchiseeName || "לא זוהה",
        totalAmount,
        commissionAmount: 0,
        commissionRate: 0,
        netAmount: totalAmount,
        transactionCount: rows.length,
        lineItems,
      },
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(`שגיאה בקריאת קובץ טאביט: ${error instanceof Error ? error.message : String(error)}`);
    return { success: false, data: null, errors, warnings };
  }
}
