/**
 * Hever (חבר) Excel parser
 *
 * Hever sends an Excel file with ALL franchisees' transaction data.
 * Unlike other clients, one file → multiple franchisees (like Tabit).
 *
 * Sheet: "מימושים  " (Redemptions)
 *   - Sections per business, each starting with a header row
 *   - Columns: מחזור קניות סליקה בתוספת סכום הנחה, סכום הנחה לספק,
 *              מחזור קניות סליקה, מספר כרטיס, מספר הזמנה כרטיס מתנה,
 *              שם בית עסק, מספר בית עסק, תאריך קליטה, תאריך קניה
 *   - Column A = gross amount (with discount)
 *   - Column F = business name (maps to franchisee)
 *
 * Multiple "שיוך" sections (e.g., 391 = "חבר טעמים", 392 = "חבר שלי")
 * share the same businesses — amounts from all sections are summed.
 */

import * as XLSX from "xlsx";

/** Per-business aggregated result */
export interface HeverBusinessResult {
  businessName: string;
  businessNumber: number | null;
  totalAmount: number;
  transactionCount: number;
}

/** Full parsed result from a Hever file */
export interface HeverParsedResult {
  success: boolean;
  businesses: HeverBusinessResult[];
  period: { month: number; year: number } | null;
  errors: string[];
  warnings: string[];
}

const HEADER_MARKER = "שם בית עסק";

/**
 * Parse a Hever Excel report.
 * Returns per-business totals from the redemptions sheet.
 */
export function parseHeverFile(
  buffer: Buffer,
): HeverParsedResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });

    // Find the redemptions detail sheet (מימושים, not סיכומי)
    const detailSheet = workbook.SheetNames.find(
      (name) => name.includes("מימושים") && !name.includes("סיכומ")
    );

    if (!detailSheet) {
      errors.push(
        `לא נמצא גיליון מימושים. גיליונות: ${workbook.SheetNames.join(", ")}`
      );
      return { success: false, businesses: [], period: null, errors, warnings };
    }

    const sheet = workbook.Sheets[detailSheet];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
    }) as unknown[][];

    // Extract period from early rows (e.g., "03/2026")
    let period: { month: number; year: number } | null = null;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        const s = String(cell ?? "").trim();
        const m = s.match(/^(\d{2})\/(\d{4})$/);
        if (m) {
          period = { month: parseInt(m[1]), year: parseInt(m[2]) };
          break;
        }
      }
      if (period) break;
    }

    // Scan all rows: sum column A (index 0) per business name (column F, index 5)
    // Skip header rows (detected by HEADER_MARKER in column F)
    const businessTotals = new Map<
      string,
      { amount: number; count: number; businessNumber: number | null }
    >();

    for (const row of rows) {
      if (!Array.isArray(row)) continue;

      const bizName = row[5];
      if (
        typeof bizName !== "string" ||
        bizName.trim().length < 2 ||
        bizName.includes(HEADER_MARKER) ||
        bizName.includes("סה\"כ") ||
        bizName.includes("דו\"ח")
      ) {
        continue;
      }

      const amount = typeof row[0] === "number" ? row[0] : 0;
      if (amount === 0) continue;

      const name = bizName.trim();
      const existing = businessTotals.get(name);
      const bizNum = typeof row[6] === "number" ? row[6] : null;

      if (existing) {
        existing.amount += amount;
        existing.count++;
        if (!existing.businessNumber && bizNum) existing.businessNumber = bizNum;
      } else {
        businessTotals.set(name, {
          amount,
          count: 1,
          businessNumber: bizNum,
        });
      }
    }

    if (businessTotals.size === 0) {
      errors.push("לא נמצאו עסקאות בגיליון המימושים");
      return { success: false, businesses: [], period: null, errors, warnings };
    }

    const businesses: HeverBusinessResult[] = [];
    for (const [name, data] of businessTotals) {
      businesses.push({
        businessName: name,
        businessNumber: data.businessNumber,
        totalAmount: Math.round(data.amount * 100) / 100,
        transactionCount: data.count,
      });
    }

    return { success: true, businesses, period, errors, warnings };
  } catch (error) {
    errors.push(
      `שגיאה בקריאת Excel חבר: ${error instanceof Error ? error.message : String(error)}`
    );
    return { success: false, businesses: [], period: null, errors, warnings };
  }
}
