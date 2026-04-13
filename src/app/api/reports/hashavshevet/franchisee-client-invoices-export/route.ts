/**
 * Per-Franchisee Client-Invoices Hashavshevet Export
 *
 * GET /api/reports/hashavshevet/franchisee-client-invoices-export?franchiseeId=&periodMonth=&periodYear=
 *
 * Produces a 9-column Hashavshevet import sheet for the invoices we issue TO
 * clients (Tenbis, Cibus, Giftcard, …) for the franchisee+period. Only includes
 * clients flagged `client.invoiceGeneration = true`. Amount source is the
 * approved reconciliation rows in `client_reconciliation_approval` (same
 * source-of-truth as the commission export).
 *
 * Layout (per Reut's sample "לקוחות.xlsx"):
 *   1. מפתח חשבון           — hashavshevetCode / hashavshevetName / name fallback
 *   2. שם                    — empty
 *   3. מפתח פריט             — "ארוחות" (constant)
 *   4. שם פריט                — empty
 *   5. כמות                   — 1
 *   6. מחיר                   — approved amount (incl. VAT), rounded
 *   7. אחוז הנחה לפריט        — "15.25%" (constant, represents VAT share)
 *   8. סוג המסמך              — 11
 *   9. מספר מסמך              — running 1..N
 *
 * Named range: "חוזים" → 'ייבוא חשבשבת'!$A$1:$I${lastRow}
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { franchisee } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getApprovedForExport } from "@/data-access/client-reconciliation-approval";
import { getOccasionalClientsForExport } from "@/data-access/occasional-clients";
import * as XLSX from "xlsx";

const ITEM_KEY = "ארוחות";
const DISCOUNT_PCT_NUMBER = 0.1525;
const DOCUMENT_TYPE = 11;

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

    const invoiceRows = approved.filter((a) => a.invoiceGeneration === true);

    // Fetch occasional-client rows for this franchisee+period. Already filters
    // out ignored rows and zero amounts in the data-access layer.
    const occasionalRows = await getOccasionalClientsForExport({
      franchiseeId,
      periodMonth,
      periodYear,
    });

    if (invoiceRows.length === 0 && occasionalRows.length === 0) {
      return NextResponse.json(
        { error: "אין לקוחות עם הפקת חשבונית מסומנת בתקופה זו" },
        { status: 400 }
      );
    }

    // Regular (approved) invoice rows — existing rounding rules.
    const regularEntries = invoiceRows
      .map((a) => {
        // Defensive: WOLT shouldn't normally be invoiceGeneration=true, but if
        // it is, keep the exact-decimal rule. All other clients get rounded
        // (matches Reut's sample where סיבוס/תן ביס are whole-shekel).
        const price =
          a.clientCode === "WOLT"
            ? a.netAmount !== null
              ? a.netAmount
              : a.clientAmount
            : Math.round(a.clientAmount);
        return {
          accountKey:
            a.hashavshevetCode || a.hashavshevetName || a.clientName,
          price,
        };
      })
      .filter((x) => x.price !== 0);

    // Occasional-client rows — same whole-shekel rounding rule as non-WOLT.
    const occasionalEntries = occasionalRows
      .map((o) => ({
        accountKey:
          o.hashavshevetCode || o.hashavshevetName || o.tabitColumnName,
        price: Math.round(o.totalAmount),
      }))
      .filter((x) => x.price !== 0);

    const rows = [...regularEntries, ...occasionalEntries].map(
      ({ accountKey, price }, index) => [
        accountKey, // מפתח חשבון
        "", // שם
        ITEM_KEY, // מפתח פריט
        "", // שם פריט
        1, // כמות
        price, // מחיר
        DISCOUNT_PCT_NUMBER, // אחוז הנחה לפריט — stored as 0.1525, formatted as "15.25%"
        DOCUMENT_TYPE, // סוג המסמך
        index + 1, // מספר מסמך
      ]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "אין סכומים לייצוא (כל הסכומים אפס)" },
        { status: 400 }
      );
    }

    const wb = XLSX.utils.book_new();
    const headers = [
      "מפתח חשבון",
      "שם",
      "מפתח פריט",
      "שם פריט",
      "כמות",
      "מחיר",
      "אחוז הנחה לפריט",
      "סוג המסמך",
      "מספר מסמך",
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // Column indices (0-based): 4=כמות, 5=מחיר, 6=אחוז הנחה, 7=סוג המסמך, 8=מספר מסמך
    const numericColumns: Array<[number, string]> = [
      [4, "0"],
      [5, "#,##0"],
      [6, "0.00%"],
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
    const filename = `חשבוניות לקוחות ${fr.name} ${monthName} ${periodYear}.xlsx`;

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
