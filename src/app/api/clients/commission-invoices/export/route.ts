import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  buildClientCommissionInvoicesRows,
  CLIENT_COMMISSION_INVOICES_HEADERS as HEADERS,
  loadClientCommissionInvoicesData,
} from "@/lib/hashavshevet/builders/client-commission-invoices";
import { copy } from "@/lib/hashavshevet/copy";
import * as XLSX from "xlsx";

// Worksheet name — sheet names allow spaces, so we can use the full
// Hebrew label the accountant expects to see at the bottom of the tab.
const SHEET_NAME = "עמלות לקוחות";
// Named range name — Excel's workbook-level name tokens cannot contain
// spaces (Excel silently strips such names on save, surfacing the
// "רשימות שהוסרו: טווח בעל שם" warning). Using an underscore keeps the
// name valid while remaining readable to Hashavshevet's importer.
const NAMED_RANGE = "עמלות_לקוחות";

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

    const { rows } = buildClientCommissionInvoicesRows(
      await loadClientCommissionInvoicesData({
        periodMonth,
        periodYear,
        franchiseeId,
      })
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: copy.noCommissionInvoices }, { status: 400 });
    }

    // Every column is the row's display value, in header order.
    const dataRows = rows.map(({ display }) => HEADERS.map((header) => display[header]));

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
      { wch: 14 }, // מספר הקצאה
    ];

    XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);

    // Named range — Hashavshevet's importer looks up the data by this name.
    const lastRowExcel = dataRows.length + 1; // +1 for the header row
    if (!wb.Workbook) wb.Workbook = {};
    if (!wb.Workbook.Names) wb.Workbook.Names = [];
    wb.Workbook.Names.push({
      Name: NAMED_RANGE,
      Ref: `'${SHEET_NAME}'!$A$1:$K$${lastRowExcel}`,
    });

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Filename is a static "עמלות לקוחות.xlsx" — the accountant imports
    // the same-named file into Hashavshevet every period and renames after
    // import if they need to archive. Including month/year in the name
    // caused every download to accumulate a "(2)/(3)/…" counter in their
    // downloads folder.
    const filename = "עמלות לקוחות.xlsx";
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
