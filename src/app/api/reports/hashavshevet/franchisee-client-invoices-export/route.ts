/**
 * Per-Franchisee Client-Invoices Hashavshevet Export
 *
 * GET /api/reports/hashavshevet/franchisee-client-invoices-export?franchiseeId=&periodMonth=&periodYear=
 *
 * Produces a 9-column Hashavshevet import sheet for the invoices we issue TO
 * clients (Cibus, Giftcard, …) for the franchisee+period. Only includes
 * clients flagged `client.invoiceGeneration = true` — plus TENBIS for periods
 * before July 2026, when it moved to the self-billed journal-entries export
 * (see `tenbisUsesJournalEntries`). Amount source is the
 * approved reconciliation rows in `client_reconciliation_approval` (same
 * source-of-truth as the commission export).
 *
 * Layout (per Reut's sample "לקוחות.xlsx"):
 *   1. מפתח חשבון           — hashavshevetCode / hashavshevetName / name fallback
 *   2. שם                    — empty
 *   3. מפתח פריט             — "ארוחות" by default;
 *                                LATABLEMARK client → "ארוחותש" (per-client override);
 *                                otherwise honours `franchisee.hashavshevet_revenue_account`
 *                                when set (e.g. Natanzon → "הכנסותנ" — typo intentional).
 *   4. שם פריט                — empty
 *   5. כמות                   — 1
 *   6. מחיר                   — approved amount (incl. VAT), rounded
 *   7. אחוז הנחה לפריט        — 15.2543 (represents VAT share as a 4-decimal
 *                                 number — Reut asked for number-not-percent)
 *   8. סוג המסמך              — 11
 *   9. מספר מסמך              — running 1..N
 *
 * Named range: "חוזים" → 'ייבוא חשבשבת'!$A$1:$I${lastRow}
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  buildFranchiseeClientInvoicesSheet,
  FRANCHISEE_CLIENT_INVOICES_HEADERS,
  loadFranchiseeClientInvoicesData,
} from "@/lib/hashavshevet/builders/franchisee-client-invoices";
import * as XLSX from "xlsx";

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { searchParams } = new URL(request.url);
  const franchiseeId = searchParams.get("franchiseeId");
  const periodMonth = parseInt(searchParams.get("periodMonth") ?? "");
  const periodYear = parseInt(searchParams.get("periodYear") ?? "");

  if (!franchiseeId || isNaN(periodMonth) || isNaN(periodYear)) {
    return NextResponse.json(
      { error: "נדרשים franchiseeId, periodMonth, periodYear" },
      { status: 400 }
    );
  }

  try {
    const data = await loadFranchiseeClientInvoicesData({
      franchiseeId,
      periodMonth,
      periodYear,
    });
    const sheet = buildFranchiseeClientInvoicesSheet(data);
    if (!sheet.ok) {
      return NextResponse.json(
        { error: sheet.message },
        { status: sheet.status }
      );
    }
    const { rows } = sheet;

    const wb = XLSX.utils.book_new();
    const headers = FRANCHISEE_CLIENT_INVOICES_HEADERS;
    const ws = XLSX.utils.aoa_to_sheet([
      [...headers],
      ...rows.map((row) => headers.map((header) => row.display[header])),
    ]);

    // Column indices (0-based): 4=כמות, 5=מחיר, 6=אחוז הנחה, 7=סוג המסמך, 8=מספר מסמך
    const numericColumns: Array<[number, string]> = [
      [4, "0"],
      [5, "#,##0"],
      [6, "0.0000"],
      [7, "0"],
      [8, "0"],
    ];
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let r = 1; r <= range.e.r; r++) {
      for (const [col, format] of numericColumns) {
        const cellAddress = XLSX.utils.encode_cell({ r, c: col });
        const cell = ws[cellAddress];
        if (cell && cell.v !== undefined && cell.v !== "") {
          cell.t = "n";
          cell.z = format;
        }
      }
    }

    ws["!cols"] = [
      { wch: 15 },
      { wch: 10 },
      { wch: 15 },
      { wch: 10 },
      { wch: 8 },
      { wch: 12 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "ייבוא חשבשבת");

    if (!wb.Workbook) wb.Workbook = {};
    if (!wb.Workbook.Names) wb.Workbook.Names = [];
    const lastRow = rows.length + 1;
    wb.Workbook.Names.push({
      Name: "חוזים",
      Ref: `'ייבוא חשבשבת'!$A$1:$I$${lastRow}`,
    });

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Hashavshevet requires a fixed filename — Reut overwrites locally on each
    // export by design. Do NOT add franchisee/period to the name.
    const filename = `לקוחות חשבוניות.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    console.error(
      "Error building franchisee client-invoices Hashavshevet export:",
      error
    );
    return NextResponse.json(
      { error: "שגיאה בייצוא לחשבשבת" },
      { status: 500 }
    );
  }
}
