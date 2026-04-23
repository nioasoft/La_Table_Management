import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getCommissionInvoicesForExport } from "@/data-access/commission-invoices";
import { getVatRateForDate } from "@/data-access/vatRates";
import { resolveClientHashavshevetAccount } from "@/lib/hashavshevet-account";
import * as XLSX from "xlsx";

const SHEET_NAME = "ייבוא חשבשבת";
const NAMED_RANGE = "תנועות";

// Header row — verbatim from the user's template file (typos preserved on purpose,
// Hashavshevet's importer expects this exact layout).
const HEADERS = [
  "אסמתכא 2",      // A — last 4 digits of invoice number
  "תאריך אסמכתא",   // B — invoice date
  "תאריך ערך",     // C — value date (same as B)
  "חן חובה 1",     // D — fixed: "עמלות מלקוחות"
  "חוז חובה 2",    // E — fixed: "מעמתש"
  "חן זכות",       // F — client's Hashavshevet account (per brand)
  "סכום חובה",     // G — pre-VAT amount = I / (1 + vat)
  "סכום חובה 2",   // H — VAT amount = I − G
  "סכום זכות 2",   // I — total with VAT
  "פרטים",         // J — "עמלה <Hebrew month>"
] as const;

const DEBIT_ACCOUNT_1 = "עמלות מלקוחות";
const DEBIT_ACCOUNT_2 = "מעמתש";

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

// Excel epoch is 1899-12-30 (accounts for the Lotus 1-2-3 leap-year bug).
// Using UTC on both sides avoids any DST/timezone drift for a whole-day serial.
function toExcelSerial(localDate: Date): number {
  const utcMs = Date.UTC(
    localDate.getFullYear(),
    localDate.getMonth(),
    localDate.getDate()
  );
  return Math.floor((utcMs - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function lastDayOfMonth(year: number, month1Based: number): Date {
  // new Date(y, m, 0) → last day of month (m-1), i.e. last day of month1Based.
  return new Date(year, month1Based, 0);
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}

function invoiceRef(invoiceNumber: string | null): string {
  if (!invoiceNumber) return "";
  const digits = invoiceNumber.replace(/\D/g, "");
  const base = digits.length > 0 ? digits : invoiceNumber;
  return base.slice(-4);
}

/**
 * GET /api/clients/commission-invoices/export
 * Export the period's client commission invoices to a Hashavshevet-ready xlsx.
 *
 * Query params:
 *   periodMonth  (1–12, required)
 *   periodYear   (required)
 *   franchiseeId (optional — restrict to a single franchisee)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const periodMonth = parseInt(searchParams.get("periodMonth") ?? "", 10);
    const periodYear = parseInt(searchParams.get("periodYear") ?? "", 10);
    const franchiseeId = searchParams.get("franchiseeId") || null;

    if (
      !Number.isInteger(periodMonth) ||
      periodMonth < 1 ||
      periodMonth > 12 ||
      !Number.isInteger(periodYear) ||
      periodYear < 2000 ||
      periodYear > 2100
    ) {
      return NextResponse.json(
        { error: "periodMonth/periodYear לא תקינים" },
        { status: 400 }
      );
    }

    const exportRows = await getCommissionInvoicesForExport(
      periodMonth,
      periodYear,
      franchiseeId
    );

    if (exportRows.length === 0) {
      return NextResponse.json(
        { error: "אין חשבוניות עמלה לתקופה הנבחרת" },
        { status: 400 }
      );
    }

    // Invoice-date and VAT rate are period-scoped: all rows in the export fall
    // in the same month, so compute once.
    const invoiceDate = lastDayOfMonth(periodYear, periodMonth);
    const invoiceDateSerial = toExcelSerial(invoiceDate);
    const vatRate = await getVatRateForDate(invoiceDate);
    const vatMultiplier = 1 + vatRate;
    const monthName = HEBREW_MONTHS[periodMonth - 1];
    const description = `עמלה ${monthName}`;

    // Build rows
    const dataRows = exportRows.map((row) => {
      const totalWithVat = roundTo2(row.totalAmountWithVat);
      const netAmount = roundTo2(totalWithVat / vatMultiplier);
      const vatAmount = roundTo2(totalWithVat - netAmount);
      const accountName = resolveClientHashavshevetAccount(
        row.clientHashavshevet,
        row.brandId
      );

      return [
        invoiceRef(row.invoiceNumber), // A
        invoiceDateSerial,              // B
        invoiceDateSerial,              // C
        DEBIT_ACCOUNT_1,                // D
        DEBIT_ACCOUNT_2,                // E
        accountName,                    // F
        netAmount,                      // G
        vatAmount,                      // H
        totalWithVat,                   // I
        description,                    // J
      ];
    });

    const aoa: (string | number)[][] = [
      [...HEADERS],
      ...dataRows,
    ];

    // Create worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Numeric / date column formatting:
    //   B, C → date serials rendered as dd/mm/yyyy
    //   G, H, I → money with thousands separator & 2 decimals
    const dateFormat = "dd/mm/yyyy";
    const moneyFormat = "#,##0.00";
    const columnFormats: Array<{ col: number; format: string }> = [
      { col: 1, format: dateFormat },
      { col: 2, format: dateFormat },
      { col: 6, format: moneyFormat },
      { col: 7, format: moneyFormat },
      { col: 8, format: moneyFormat },
    ];
    const lastDataRow = dataRows.length; // 0-indexed: data rows are rows 1..lastDataRow
    for (let r = 1; r <= lastDataRow; r++) {
      for (const { col, format } of columnFormats) {
        const addr = XLSX.utils.encode_cell({ r, c: col });
        const cell = ws[addr];
        if (cell && cell.v !== undefined && cell.v !== "") {
          cell.t = "n";
          cell.z = format;
        }
      }
    }

    // Column widths — tuned so Hebrew headers fit without wrapping.
    ws["!cols"] = [
      { wch: 10 }, // אסמתכא 2
      { wch: 14 }, // תאריך אסמכתא
      { wch: 14 }, // תאריך ערך
      { wch: 18 }, // חן חובה 1
      { wch: 14 }, // חוז חובה 2
      { wch: 28 }, // חן זכות
      { wch: 12 }, // סכום חובה
      { wch: 12 }, // סכום חובה 2
      { wch: 12 }, // סכום זכות 2
      { wch: 18 }, // פרטים
    ];

    XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);

    // Named range — Hashavshevet's importer looks up the data by this name.
    const lastRowExcel = dataRows.length + 1; // +1 for the header row
    if (!wb.Workbook) wb.Workbook = {};
    if (!wb.Workbook.Names) wb.Workbook.Names = [];
    wb.Workbook.Names.push({
      Name: NAMED_RANGE,
      Ref: `'${SHEET_NAME}'!$A$1:$J$${lastRowExcel}`,
    });

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    const filename = `עמלות לקוחות ${monthName} ${periodYear}.xlsx`;
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
    console.error("Error exporting commission invoices to Hashavshevet:", error);
    return NextResponse.json(
      { error: "שגיאה בייצוא הקובץ" },
      { status: 500 }
    );
  }
}
