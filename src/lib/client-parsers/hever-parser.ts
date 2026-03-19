/**
 * Hever (חבר) Excel parser
 *
 * Hever sends an Excel file with ALL franchisees' transaction data.
 * The file has multiple sheets:
 *   - "מימושים  " - Raw transactions per franchisee
 *   - "מימושים - סיכומי" - Summary totals per franchisee
 *
 * The summary sheet has columns:
 *   Row 6: Headers - סכום ברוטו לפני הנחה, סכום הנחה לספק, סכום מימוש נטו לספק לאחר הנחה, שם אב רשת, מספר אב רשת, שיוך
 *   Row 7+: Data rows per franchisee
 *
 * We extract per-franchisee gross amounts. The commission is NOT in the file -
 * it's calculated from the commission rate configured on the client entity.
 *
 * Returns one result per call (the whole file), with line items per franchisee.
 */

import * as XLSX from "xlsx";
import type { ClientDocumentProcessingResult, ClientParsedLineItem } from "./types";

interface HeverFranchiseeRow {
  grossAmount: number;
  discount: number;
  netAmount: number;
  networkName: string;
  networkId: string | number;
  shiyuch: string | number;
}

/**
 * Parse a Hever Excel report.
 * Extracts per-franchisee totals from the summary sheet.
 */
export async function parseHeverFile(
  buffer: Buffer,
  mimeType: string
): Promise<ClientDocumentProcessingResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });

    // Find summary sheet
    const summarySheetName = workbook.SheetNames.find(
      (name) => name.includes("סיכומי") && name.includes("מימושים")
    );

    if (!summarySheetName) {
      // Try to find by index or partial match
      const altSheet = workbook.SheetNames.find((name) =>
        name.includes("סיכומ")
      );
      if (!altSheet) {
        errors.push(
          `לא נמצא גיליון סיכומי מימושים. גיליונות: ${workbook.SheetNames.join(", ")}`
        );
        return { success: false, data: null, errors, warnings };
      }
    }

    const sheetName = summarySheetName || workbook.SheetNames[2]; // Fallback to 3rd sheet
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
    }) as unknown as unknown[][];

    // Find header row (contains "סכום ברוטו" or "שם אב רשת")
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const row = rows[i];
      if (
        Array.isArray(row) &&
        row.some(
          (cell) =>
            typeof cell === "string" &&
            (cell.includes("סכום ברוטו") || cell.includes("שם אב רשת"))
        )
      ) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) {
      errors.push("לא נמצאה שורת כותרות בגיליון הסיכומי");
      return { success: false, data: null, errors, warnings };
    }

    // Parse header columns
    const headerRow = rows[headerRowIdx] as string[];
    const colMap: Record<string, number> = {};
    headerRow.forEach((cell, idx) => {
      const s = String(cell).trim();
      if (s.includes("סכום ברוטו")) colMap.grossAmount = idx;
      else if (s.includes("סכום הנחה")) colMap.discount = idx;
      else if (s.includes("סכום מימוש נטו")) colMap.netAmount = idx;
      else if (s.includes("שם אב רשת") || s.includes("שם")) colMap.networkName = idx;
      else if (s.includes("מספר אב רשת") || s.includes("מספר")) colMap.networkId = idx;
      else if (s.includes("שיוך")) colMap.shiyuch = idx;
    });

    // Parse data rows (after header)
    const franchiseeRows: HeverFranchiseeRow[] = [];
    let totalGross = 0;

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i] as (string | number)[];
      if (!Array.isArray(row)) continue;

      const gross =
        typeof row[colMap.grossAmount] === "number"
          ? row[colMap.grossAmount] as number
          : parseFloat(String(row[colMap.grossAmount] || "0"));

      const name = String(row[colMap.networkName] || "").trim();

      // Skip empty rows and summary rows
      if (!name || gross === 0 || isNaN(gross)) continue;

      const discount =
        typeof row[colMap.discount] === "number"
          ? row[colMap.discount] as number
          : parseFloat(String(row[colMap.discount] || "0"));

      const net =
        typeof row[colMap.netAmount] === "number"
          ? row[colMap.netAmount] as number
          : parseFloat(String(row[colMap.netAmount] || "0"));

      franchiseeRows.push({
        grossAmount: gross,
        discount,
        netAmount: net,
        networkName: name,
        networkId: row[colMap.networkId] || "",
        shiyuch: row[colMap.shiyuch] || "",
      });

      totalGross += gross;
    }

    if (franchiseeRows.length === 0) {
      errors.push("לא נמצאו שורות נתונים בגיליון הסיכומי");
      return { success: false, data: null, errors, warnings };
    }

    // Extract period from sheet data (row 2 typically has "02/2026")
    let periodMonth: number | undefined;
    let periodYear: number | undefined;
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const row = rows[i];
      if (Array.isArray(row)) {
        for (const cell of row) {
          const s = String(cell).trim();
          const m = s.match(/(\d{2})\/(\d{4})/);
          if (m) {
            periodMonth = parseInt(m[1]);
            periodYear = parseInt(m[2]);
            break;
          }
        }
      }
      if (periodMonth) break;
    }

    // Build line items per franchisee
    const lineItems: ClientParsedLineItem[] = franchiseeRows.map((fr) => ({
      date: null,
      description: `${fr.networkName} (${fr.shiyuch})`,
      amount: fr.grossAmount,
      commission: 0, // Commission calculated from client config rate, not in file
    }));

    return {
      success: true,
      data: {
        franchiseeName: "כל הרשת", // Hever file covers all franchisees
        totalAmount: totalGross,
        commissionAmount: 0, // Will be calculated from client's configured rate
        commissionRate: 0, // Will be filled from client config
        netAmount: totalGross, // Gross = what we need to invoice (minus commission)
        transactionCount: franchiseeRows.length,
        periodMonth,
        periodYear,
        lineItems,
        rawText: `${franchiseeRows.length} זכיינים, סה"כ ברוטו: ${totalGross.toLocaleString("he-IL")} ₪`,
      },
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(
      `שגיאה בקריאת Excel חבר: ${error instanceof Error ? error.message : String(error)}`
    );
    return { success: false, data: null, errors, warnings };
  }
}
