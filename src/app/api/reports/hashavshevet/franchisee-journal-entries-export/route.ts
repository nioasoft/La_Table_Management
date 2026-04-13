/**
 * Per-Franchisee Journal-Entries Hashavshevet Export
 *
 * GET /api/reports/hashavshevet/franchisee-journal-entries-export?franchiseeId=&periodMonth=&periodYear=
 *
 * Produces a 9-column Hashavshevet "תנועות יומן" sheet for the journal
 * entries booking the invoices we RECEIVE FROM clients — Mishlocha, Wolt,
 * HAAT today (anyone flagged `client.journalEntryGeneration = true`).
 *
 * Layout (per Reut's sample "פקודות יומן.xlsx"):
 *   1. סוג תנועה        — "הכנ" (constant)
 *   2. אסמכתא 1          — empty
 *   3. אסמתכא 2          — last 4 digits of client_document.invoice_number
 *   4. תאריך אסמכתא      — last day of period (DD/MM/YYYY)
 *   5. תאריך ערך         — last day of period
 *   6. חן חובה           — client.hashavshevetName (or hashavshevetCode / name fallback)
 *   7. חן זכות           — empty
 *   8. סכום חובה         — total incl. VAT (Wolt: exact netAmount; others: rounded clientAmount)
 *   9. סכום זכות         — same as column 8
 *
 * Named range: "תנועות יומן" → 'ייבוא חשבשבת'!$A$1:$I${lastRow}
 *
 * Note: column-3 header in Reut's sample has a Hebrew spelling typo
 * ("אסמתכא" instead of "אסמכתא"); matched verbatim so Hashavshevet import
 * lines up column-by-column.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { franchisee } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getApprovedForExport } from "@/data-access/client-reconciliation-approval";
import * as XLSX from "xlsx";

const TRANSACTION_TYPE = "הכנ";

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
    const [fr] = await database
      .select({ name: franchisee.name })
      .from(franchisee)
      .where(eq(franchisee.id, franchiseeId))
      .limit(1);

    if (!fr) {
      return NextResponse.json({ error: "זכיין לא נמצא" }, { status: 404 });
    }

    const approved = await getApprovedForExport({
      franchiseeId,
      periodMonth,
      periodYear,
    });

    const journalRows = approved.filter(
      (a) => a.journalEntryGeneration === true
    );

    if (journalRows.length === 0) {
      return NextResponse.json(
        { error: "אין לקוחות עם הפקת פקודת יומן מסומנת בתקופה זו" },
        { status: 400 }
      );
    }

    // Last day of the period month. JS trick: day 0 of next month == last day of this month.
    const lastDay = new Date(periodYear, periodMonth, 0);

    const rows = journalRows
      .map((a) => {
        // Wolt: exact net (matches what we pay Wolt on their invoice).
        // Others: rounded client amount (matches sample).
        const amount =
          a.clientCode === "WOLT"
            ? a.netAmount !== null
              ? a.netAmount
              : a.clientAmount
            : Math.round(a.clientAmount);
        return { row: a, amount };
      })
      .filter((x) => x.amount !== 0)
      .map(({ row, amount }) => {
        const last4 = row.invoiceNumber
          ? row.invoiceNumber.replace(/\D/g, "").slice(-4)
          : "";
        // Journal-entries export uses a name-first fallback (unique to this
        // sheet — the other exports use code-first). Still honours the
        // per-brand override when present.
        const perBrandOverride =
          row.franchiseeBrandId && row.hashavshevetByBrand
            ? row.hashavshevetByBrand[row.franchiseeBrandId]?.trim()
            : "";
        const debitAccount =
          perBrandOverride ||
          row.hashavshevetName ||
          row.hashavshevetCode ||
          row.clientName;
        return [
          TRANSACTION_TYPE, // סוג תנועה
          "", // אסמכתא 1
          last4, // אסמתכא 2 (last 4 digits of invoice number)
          lastDay, // תאריך אסמכתא
          lastDay, // תאריך ערך
          debitAccount, // חן חובה
          "", // חן זכות
          amount, // סכום חובה
          amount, // סכום זכות
        ];
      });

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "אין סכומים לייצוא (כל הסכומים אפס)" },
        { status: 400 }
      );
    }

    const wb = XLSX.utils.book_new();
    const headers = [
      "סוג תנועה",
      "אסמכתא 1",
      "אסמתכא 2", // matches Reut's sample spelling (typo preserved)
      "תאריך אסמכתא",
      "תאריך ערך",
      "חן חובה",
      "חן זכות",
      "סכום חובה",
      "סכום זכות",
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows], { cellDates: true });

    // Cell formatting. Column indices (0-based):
    //  3 = תאריך אסמכתא (date), 4 = תאריך ערך (date),
    //  7 = סכום חובה, 8 = סכום זכות (currency).
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let r = 1; r <= range.e.r; r++) {
      for (const c of [3, 4]) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell) {
          cell.t = "d";
          cell.z = "dd/mm/yyyy";
        }
      }
      for (const c of [7, 8]) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell && cell.v !== undefined && cell.v !== "") {
          cell.t = "n";
          cell.z = "#,##0.00";
        }
      }
    }

    ws["!cols"] = [
      { wch: 10 }, // סוג תנועה
      { wch: 10 }, // אסמכתא 1
      { wch: 12 }, // אסמתכא 2
      { wch: 14 }, // תאריך אסמכתא
      { wch: 14 }, // תאריך ערך
      { wch: 20 }, // חן חובה
      { wch: 12 }, // חן זכות
      { wch: 14 }, // סכום חובה
      { wch: 14 }, // סכום זכות
    ];

    XLSX.utils.book_append_sheet(wb, ws, "ייבוא חשבשבת");

    if (!wb.Workbook) wb.Workbook = {};
    if (!wb.Workbook.Names) wb.Workbook.Names = [];
    const lastRow = rows.length + 1;
    wb.Workbook.Names.push({
      Name: "תנועות יומן",
      Ref: `'ייבוא חשבשבת'!$A$1:$I$${lastRow}`,
    });

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    const MONTHS = [
      "ינואר",
      "פברואר",
      "מרץ",
      "אפריל",
      "מאי",
      "יוני",
      "יולי",
      "אוגוסט",
      "ספטמבר",
      "אוקטובר",
      "נובמבר",
      "דצמבר",
    ];
    const monthName = MONTHS[periodMonth - 1] || String(periodMonth);
    const filename = `תנועות יומן ${fr.name} ${monthName} ${periodYear}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    console.error(
      "Error building franchisee journal-entries Hashavshevet export:",
      error
    );
    return NextResponse.json(
      { error: "שגיאה בייצוא לחשבשבת" },
      { status: 500 }
    );
  }
}
