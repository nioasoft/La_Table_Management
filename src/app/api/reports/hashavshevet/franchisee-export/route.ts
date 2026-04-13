/**
 * Per-Franchisee Hashavshevet Export
 *
 * GET /api/reports/hashavshevet/franchisee-export?franchiseeId=&periodMonth=&periodYear=&exportType=invoice|journal
 *
 * Produces the same 8-column Hashavshevet import sheet as the per-client
 * export, but aggregates all approved (client_reconciliation_approval) rows
 * for a single franchisee in the given period.
 *
 * Special rule: for Wolt (client.code === "WOLT") the price is the EXACT net
 * amount (no rounding). Other clients keep the legacy behaviour.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { franchisee } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getApprovedForExport } from "@/data-access/client-reconciliation-approval";
import * as XLSX from "xlsx";

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { searchParams } = new URL(request.url);
  const franchiseeId = searchParams.get("franchiseeId");
  const periodMonth = parseInt(searchParams.get("periodMonth") ?? "");
  const periodYear = parseInt(searchParams.get("periodYear") ?? "");
  const exportType = searchParams.get("exportType") ?? "invoice";

  if (!franchiseeId || isNaN(periodMonth) || isNaN(periodYear)) {
    return NextResponse.json(
      { error: "נדרשים franchiseeId, periodMonth, periodYear" },
      { status: 400 }
    );
  }

  const documentTypeNumber = exportType === "journal" ? 1 : 11;

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

    if (approved.length === 0) {
      return NextResponse.json(
        { error: "אין שורות מאושרות לייצוא" },
        { status: 400 }
      );
    }

    // Build Hashavshevet rows.
    // Price rule:
    //  - WOLT: exact netAmount (or clientAmount fallback) — no rounding.
    //  - LA TABLE (invoice exports only): half of the Tabit amount.
    //    (Journal entries keep the full amount — that's the bookkeeping value.)
    //  - other clients: Math.round of clientAmount (legacy behaviour).
    const isInvoiceExport = exportType !== "journal";
    const rows = approved
      .map((a) => {
        const isWolt = a.clientCode === "WOLT";
        const isLaTableInvoice =
          a.clientCode === "LATABLE" && isInvoiceExport;
        let price: number;
        if (isWolt) {
          // Use exact net when we have it; else exact client amount.
          price = a.netAmount !== null ? a.netAmount : a.clientAmount;
        } else if (isLaTableInvoice) {
          price = Math.round(a.clientAmount / 2);
        } else {
          price = Math.round(a.clientAmount);
        }
        return { row: a, price };
      })
      .filter((x) => x.price !== 0)
      .map(({ row, price }) => [
        row.accountKey, // מפתח חשבון
        "", // שם
        `עמלות ${fr.name}`, // מפתח פריט
        "", // שם פריט
        1, // כמות
        price, // מחיר
        documentTypeNumber, // סוג המסמך
        "", // מספר מסמך
      ]);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "אין סכומים לייצוא (כל הסכומים אפס)" },
        { status: 400 }
      );
    }

    // Build workbook (identical layout to client-export)
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
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    const numericColumns: [number, string][] = [
      [4, "0"], // כמות
      [5, "#,##0.00"], // מחיר — keep decimal formatting so Wolt's .00 decimals show
      [6, "0"], // סוג המסמך
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
      { wch: 15 },
      { wch: 10 },
      { wch: 35 },
      { wch: 10 },
      { wch: 8 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "ייבוא חשבשבת");

    // Named range required by Hashavshevet import
    if (!wb.Workbook) wb.Workbook = {};
    if (!wb.Workbook.Names) wb.Workbook.Names = [];
    const lastRow = rows.length + 1;
    wb.Workbook.Names.push({
      Name: "חוזים",
      Ref: `'ייבוא חשבשבת'!$A$1:$H$${lastRow}`,
    });

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    const MONTHS = [
      "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
      "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
    ];
    const monthName = MONTHS[periodMonth - 1] || String(periodMonth);
    const typeLabel = exportType === "journal" ? "פקודת יומן" : "חשבוניות";
    const filename = `${typeLabel} ${fr.name} ${monthName} ${periodYear}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    console.error("Error building franchisee Hashavshevet export:", error);
    return NextResponse.json(
      { error: "שגיאה בייצוא לחשבשבת" },
      { status: 500 }
    );
  }
}
