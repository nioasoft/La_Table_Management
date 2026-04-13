/**
 * Hashavshevet Export for Client Reconciliation
 *
 * Generates an Excel file in the exact same 8-column format as the
 * supplier Hashavshevet export, but with client reconciliation data.
 *
 * GET /api/reports/hashavshevet/client-export?sessionId=xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { client } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getApprovedComparisonsForExport,
  getSessionWithComparisons,
} from "@/data-access/client-reconciliation";
import { resolveClientHashavshevetAccount } from "@/lib/hashavshevet-account";
import * as XLSX from "xlsx";

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  const exportType = searchParams.get("exportType") ?? "invoice"; // "invoice" | "journal"

  if (!sessionId) {
    return NextResponse.json(
      { error: "נדרש sessionId" },
      { status: 400 }
    );
  }

  // Document type: 11 = invoice (חשבונית), 1 = journal entry (פקודת יומן)
  const documentTypeNumber = exportType === "journal" ? 1 : 11;

  try {
    // Get session info for filename
    const sessionData = await getSessionWithComparisons(sessionId);
    if (!sessionData) {
      return NextResponse.json(
        { error: "התאמה לא נמצאה" },
        { status: 404 }
      );
    }

    const { session } = sessionData;

    // Get client's Hashavshevet account data (global + per-brand overrides)
    // and code (needed for the LA TABLE half-price invoice rule).
    // This export spans multiple franchisees, so the account key is resolved
    // per row below using each franchisee's brand.
    const [clientRow] = await database
      .select({
        code: client.code,
        hashavshevetCode: client.hashavshevetCode,
        hashavshevetName: client.hashavshevetName,
        hashavshevetByBrand: client.hashavshevetByBrand,
        name: client.name,
      })
      .from(client)
      .where(eq(client.id, session.clientId))
      .limit(1);

    if (!clientRow) {
      return NextResponse.json(
        { error: "לקוח לא נמצא" },
        { status: 404 }
      );
    }

    // Get approved comparisons
    const comparisons = await getApprovedComparisonsForExport(sessionId);

    if (comparisons.length === 0) {
      return NextResponse.json(
        { error: "אין שורות מאושרות לייצוא" },
        { status: 400 }
      );
    }

    // Build Hashavshevet rows - exact same format as supplier export.
    // LA TABLE special rule: on invoice exports only, the amount is halved
    // (the bookkeeping value is what Tabit shows, but the invoice we issue
    // is for 50% of it). Journal-entry exports keep the full amount.
    const isInvoiceExport = exportType !== "journal";
    const isLaTableInvoice =
      clientRow.code === "LATABLE" && isInvoiceExport;
    const rows = comparisons
      .filter((comp) => {
        const net = comp.netAmount ? parseFloat(comp.netAmount) : 0;
        return net !== 0;
      })
      .map((comp) => {
        const rawAmount = comp.netAmount ? parseFloat(comp.netAmount) : 0;
        const price = isLaTableInvoice
          ? Math.round(rawAmount / 2)
          : Math.round(rawAmount);
        return [
          resolveClientHashavshevetAccount(clientRow, comp.franchiseeBrandId), // מפתח חשבון
          "", // שם
          `עמלות ${comp.franchiseeName}`, // מפתח פריט
          "", // שם פריט
          1, // כמות
          price, // מחיר
          documentTypeNumber, // סוג המסמך (11=חשבונית, 1=פקודת יומן)
          "", // מספר מסמך
        ];
      });

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "אין סכומים לייצוא (כל הסכומים אפס)" },
        { status: 400 }
      );
    }

    // Create workbook in identical format
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

    const data = [headers, ...rows];

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set numeric columns (same as supplier export)
    const numericColumns: [number, string][] = [
      [4, "0"], // כמות - integer
      [5, "#,##0.00"], // מחיר - decimal
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

    // Set column widths (same as supplier export)
    ws["!cols"] = [
      { wch: 15 }, // מפתח חשבון
      { wch: 10 }, // שם
      { wch: 35 }, // מפתח פריט
      { wch: 10 }, // שם פריט
      { wch: 8 }, // כמות
      { wch: 12 }, // מחיר
      { wch: 12 }, // סוג המסמך
      { wch: 12 }, // מספר מסמך
    ];

    XLSX.utils.book_append_sheet(wb, ws, "ייבוא חשבשבת");

    // Add named range "חוזים" (required for Hashavshevet import)
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
    const monthName = MONTHS[session.periodMonth - 1] || String(session.periodMonth);
    const typeLabel = exportType === "journal" ? "פקודת יומן" : "חשבוניות";
    const filename = `${typeLabel} ${session.clientName} ${monthName} ${session.periodYear}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (error) {
    console.error("Error generating client Hashavshevet export:", error);
    return NextResponse.json(
      { error: "שגיאה ביצירת קובץ חשבשבת" },
      { status: 500 }
    );
  }
}
