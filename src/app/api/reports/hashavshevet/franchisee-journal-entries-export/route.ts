/**
 * Per-Franchisee Journal-Entries Hashavshevet Export
 *
 * GET /api/reports/hashavshevet/franchisee-journal-entries-export?franchiseeId=&periodMonth=&periodYear=
 *
 * Produces an 11-column Hashavshevet "תנועות" sheet for the journal
 * entries booking the invoices we RECEIVE FROM clients — Mishlocha, Wolt,
 * HAAT, and Tenbis from the July-2026 period (anyone flagged
 * `client.journalEntryGeneration = true`; TENBIS is period-gated via
 * `tenbisUsesJournalEntries` — earlier periods stay in the client-invoices
 * export).
 *
 * Layout (per Reut's revised sample):
 *   A. אסמתכא 2          — MISHLOCHA/HAAT/WOLT/TENBIS: last 4 digits of invoice#;
 *                            HEVER: "9999" placeholder (both rows);
 *                            CIBUS/everyone else: empty.
 *   B. תאריך אסמכתא      — last day of period (DD/MM/YYYY)
 *   C. תאריך ערך         — last day of period
 *   D. חן חובה           — debit account (per-brand override → hashavshevetName → code → name)
 *   E. חן זכות 1         — regular: `הכנסות` (or `הכנסותנ` for Natanzon);
 *                            HEVER commission row: `הכנ עמלות חבר`;
 *                            HEVER contra row: HEVER's resolved account.
 *   F. חן זכות 2         — "מעמעס" (VAT account) on VAT-split rows; empty on HEVER contra
 *   G. סכום חובה         — exact amount (Wolt: netAmount; others: clientAmount), no rounding
 *   H. סכום זכות 1       — pre-VAT amount. Formula `=G-I` on VAT-split rows; static gross on HEVER contra
 *   I. סכום זכות 2       — VAT portion. Formula `=G/1.18*0.18` on VAT-split rows; empty on HEVER contra
 *   J. פרטים             — "ארוחות" for regular rows; "עמלה" for HEVER commission;
 *                            "מיון" for HEVER-to-אמריקן contra.
 *   K. מספר הקצאה        — Israeli tax allocation number (9 digits) extracted from
 *                            the source invoice. Only required by law on invoices
 *                            over ₪10,000 (dropping to ₪5,000) — empty when absent.
 *                            HEVER contra row is always empty (it's a routing entry,
 *                            not a real invoice line).
 *
 * Named range: "תנועות" → 'ייבוא חשבשבת'!$A$1:$K${lastRow}
 *
 * Note: column-A header uses the Hebrew spelling typo from Reut's sample
 * ("אסמתכא" instead of "אסמכתא"); matched verbatim so Hashavshevet import
 * lines up column-by-column.
 *
 * HEVER exception: emits TWO rows instead of one (replaces the standard row):
 *   Row 1 — VAT-split row with debit=HEVER, amount = −18% of gross (commission).
 *   Row 2 — contra entry: debit=HEVER, credit 1="אמריקן", gross in סכום זכות 1;
 *           no VAT split (F and I empty), אסמתכא 2 = "9999" like row 1.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  buildJournalEntriesSheet,
  JOURNAL_ENTRIES_HEADERS,
  loadJournalEntriesData,
  VAT_RATE,
} from "@/lib/hashavshevet/builders/journal-entries";
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
    const data = await loadJournalEntriesData({
      franchiseeId,
      periodMonth,
      periodYear,
    });
    const sheet = buildJournalEntriesSheet(data);
    if (!sheet.ok) {
      return NextResponse.json(
        { error: sheet.message },
        { status: sheet.status }
      );
    }
    const { lines } = sheet;

    // Last day of the period month. JS trick: day 0 of next month == last day of this month.
    const lastDay = new Date(periodYear, periodMonth, 0);

    const wb = XLSX.utils.book_new();
    const headers = JOURNAL_ENTRIES_HEADERS;
    // B and C are real date cells; every other column is the row's display value.
    const ws = XLSX.utils.aoa_to_sheet(
      [
        [...headers],
        ...lines.map(({ row }) =>
          headers.map((header, c) => (c === 1 || c === 2 ? lastDay : row.display[header]))
        ),
      ],
      { cellDates: true }
    );

    // Cell formatting and formulas. Column indices (0-based):
    //  1 = תאריך אסמכתא, 2 = תאריך ערך (date),
    //  6 = סכום חובה, 7 = סכום זכות 1, 8 = סכום זכות 2 (currency).
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let r = 1; r <= range.e.r; r++) {
      // Date columns (B, C)
      for (const c of [1, 2]) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell) {
          cell.t = "d";
          cell.z = "dd/mm/yyyy";
        }
      }

      // Currency column G (gross)
      const gAddr = XLSX.utils.encode_cell({ r, c: 6 });
      const gCell = ws[gAddr];
      if (gCell && gCell.v !== undefined && gCell.v !== "") {
        gCell.t = "n";
        gCell.z = "#,##0.00";
      }

      const excelRow = r + 1; // Excel rows are 1-indexed
      const meta = lines[r - 1];

      if (meta.vatSplit) {
        // Cached values so the sheet renders correctly before Excel recalcs.
        const preVat = meta.row.display["סכום זכות 1"];
        const vat = meta.row.display["סכום זכות 2"];

        // H: סכום זכות 1 = pre-VAT (formula =G-I)
        ws[XLSX.utils.encode_cell({ r, c: 7 })] = {
          t: "n",
          v: preVat,
          f: `G${excelRow}-I${excelRow}`,
          z: "#,##0.00",
        };
        // I: סכום זכות 2 = VAT portion (formula =G/1.18*0.18)
        ws[XLSX.utils.encode_cell({ r, c: 8 })] = {
          t: "n",
          v: vat,
          f: `G${excelRow}/${1 + VAT_RATE}*${VAT_RATE}`,
          z: "#,##0.00",
        };
      } else {
        // HEVER contra row: H is a static gross value, I is left empty.
        const hAddr = XLSX.utils.encode_cell({ r, c: 7 });
        const hCell = ws[hAddr];
        if (hCell && hCell.v !== undefined && hCell.v !== "") {
          hCell.t = "n";
          hCell.z = "#,##0.00";
        }
        delete ws[XLSX.utils.encode_cell({ r, c: 8 })];
      }
    }

    ws["!cols"] = [
      { wch: 12 }, // A אסמתכא 2
      { wch: 14 }, // B תאריך אסמכתא
      { wch: 14 }, // C תאריך ערך
      { wch: 20 }, // D חן חובה
      { wch: 14 }, // E חן זכות 1
      { wch: 14 }, // F חן זכות 2
      { wch: 14 }, // G סכום חובה
      { wch: 14 }, // H סכום זכות 1
      { wch: 14 }, // I סכום זכות 2
      { wch: 20 }, // J פרטים
      { wch: 14 }, // K מספר הקצאה
    ];

    XLSX.utils.book_append_sheet(wb, ws, "ייבוא חשבשבת");

    if (!wb.Workbook) wb.Workbook = {};
    if (!wb.Workbook.Names) wb.Workbook.Names = [];
    const lastRow = lines.length + 1;
    wb.Workbook.Names.push({
      Name: "תנועות",
      Ref: `'ייבוא חשבשבת'!$A$1:$K$${lastRow}`,
    });

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Hashavshevet requires a fixed filename — Reut overwrites locally on each
    // export by design. Do NOT add franchisee/period to the name.
    const filename = `לקוחות תנועות יומן.xlsx`;

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
