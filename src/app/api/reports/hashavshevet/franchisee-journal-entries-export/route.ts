/**
 * Per-Franchisee Journal-Entries Hashavshevet Export
 *
 * GET /api/reports/hashavshevet/franchisee-journal-entries-export?franchiseeId=&periodMonth=&periodYear=
 *
 * Produces an 11-column Hashavshevet "תנועות" sheet for the journal
 * entries booking the invoices we RECEIVE FROM clients — Mishlocha, Wolt,
 * HAAT today (anyone flagged `client.journalEntryGeneration = true`).
 *
 * Layout (per Reut's revised sample):
 *   A. אסמתכא 2          — MISHLOCHA/HAAT/WOLT: last 4 digits of invoice#;
 *                            HEVER: "9999" placeholder (both rows);
 *                            CIBUS/TENBIS/everyone else: empty.
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
 *           no VAT split (F and I empty), אסמתכא 2 empty.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { franchisee } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getApprovedForExport } from "@/data-access/client-reconciliation-approval";
import * as XLSX from "xlsx";

// Israeli מע"מ (VAT) rate — 18% since January 2025.
const VAT_RATE = 0.18;
const REVENUE_ACCOUNT = "הכנסות";
const VAT_ACCOUNT = "מעמעס";

// פרטים (row-description) labels shown in column J.
const DETAILS_MEALS = "ארוחות";
const DETAILS_HEVER_COMMISSION = "עמלה";
const DETAILS_HEVER_CONTRA = "מיון";

// HEVER — special two-row journal-entry format.
// Row 1: VAT-split row for HEVER, amount = −18% of original (commission).
// Row 2: contra entry booking gross from "אמריקן" (debit) to HEVER (credit 1), no VAT split.
const HEVER_CLIENT_CODE = "HEVER";
const HEVER_COMMISSION_RATE = 0.18;
const HEVER_CONTRA_ACCOUNT = "אמריקן";
// HEVER-specific credit account for the commission row — routed to a
// dedicated commission account instead of the generic revenue one.
const HEVER_COMMISSION_CREDIT_ACCOUNT = "הכנ עמלות חבר";
// HEVER's bank-transfer file has no per-franchisee invoice number — Reut
// asked to fill a fixed placeholder in אסמכתא 2 for both HEVER rows.
const HEVER_ASMACHTA_PLACEHOLDER = "9999";

// Clients whose uploads actually carry an invoice number we can extract.
// Anything outside this set (CIBUS, TENBIS, …) leaves אסמכתא 2 empty per Reut.
const INVOICE_BEARING_CLIENT_CODES = new Set(["MISHLOCHA", "HAAT", "WOLT"]);

// Franchisee-specific revenue-account overrides now live on
// `franchisee.hashavshevet_revenue_account` (added migration 0063).
// When the column is null we fall back to REVENUE_ACCOUNT.
//
// Migrated from a hardcoded substring-match array on 2026-05-10 so Reut
// can change overrides via the admin UI instead of a code deploy.

type RowCell = string | number | Date;

interface JournalRow {
  cells: RowCell[];
  vatSplit: boolean;
}

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
      .select({
        name: franchisee.name,
        hashavshevetRevenueAccount: franchisee.hashavshevetRevenueAccount,
      })
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

    // Resolve the per-franchisee revenue account once — same for every row.
    // Per-franchisee column wins; falls back to the global default.
    const revenueAccount =
      fr.hashavshevetRevenueAccount?.trim() || REVENUE_ACCOUNT;

    const rows: JournalRow[] = journalRows
      .map((a) => {
        // Wolt prefers its net amount (what we actually pay on Wolt's invoice);
        // everyone else uses the client-reported amount. No rounding — Reut
        // needs exact values including אגורות for the accountant's VAT reconcile.
        const amount =
          a.clientCode === "WOLT" && a.netAmount !== null
            ? a.netAmount
            : a.clientAmount;
        return { row: a, amount };
      })
      .filter((x) => x.amount !== 0)
      .flatMap(({ row, amount }): JournalRow[] => {
        // אסמכתא 2 per-client rule (Reut): real invoice# (last 4 digits) only
        // for MISHLOCHA/HAAT/WOLT; HEVER gets the "9999" placeholder on both
        // of its rows; CIBUS/TENBIS and anything else stay empty.
        const asmachta2 =
          row.clientCode === HEVER_CLIENT_CODE
            ? HEVER_ASMACHTA_PLACEHOLDER
            : row.clientCode &&
                INVOICE_BEARING_CLIENT_CODES.has(row.clientCode) &&
                row.invoiceNumber
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

        // Israeli tax allocation number (מספר הקצאה) — empty when the invoice
        // didn't carry one (under threshold, or pre-feature documents).
        const allocationNumber = row.allocationNumber ?? "";

        // HEVER special: emit two rows that REPLACE the standard single row.
        if (row.clientCode === HEVER_CLIENT_CODE) {
          const commissionAmount = -(amount * HEVER_COMMISSION_RATE);
          return [
            {
              cells: [
                asmachta2,                       // A  אסמתכא 2 = "9999"
                lastDay,                         // B  תאריך אסמכתא
                lastDay,                         // C  תאריך ערך
                debitAccount,                    // D  חן חובה  (HEVER resolved)
                HEVER_COMMISSION_CREDIT_ACCOUNT, // E  חן זכות 1 = "הכנ עמלות חבר"
                VAT_ACCOUNT,                     // F  חן זכות 2
                commissionAmount,                // G  סכום חובה  (−18% of gross)
                0,                               // H  סכום זכות 1  (replaced with formula below)
                0,                               // I  סכום זכות 2  (replaced with formula below)
                DETAILS_HEVER_COMMISSION,        // J  פרטים = "עמלה"
                allocationNumber,                // K  מספר הקצאה
              ],
              vatSplit: true,
            },
            {
              cells: [
                asmachta2,              // A  אסמתכא 2 = "9999"
                lastDay,                // B  תאריך אסמכתא
                lastDay,                // C  תאריך ערך
                debitAccount,           // D  חן חובה = HEVER (resolved account)
                HEVER_CONTRA_ACCOUNT,   // E  חן זכות 1 = "אמריקן"
                "",                     // F  חן זכות 2 (no VAT)
                amount,                 // G  סכום חובה (gross original)
                amount,                 // H  סכום זכות 1 (static gross, no split)
                "",                     // I  סכום זכות 2 (no VAT)
                DETAILS_HEVER_CONTRA,   // J  פרטים = "מיון"
                "",                     // K  מספר הקצאה (contra row — not an invoice line)
              ],
              vatSplit: false,
            },
          ];
        }

        return [
          {
            cells: [
              asmachta2,        // A  אסמתכא 2
              lastDay,          // B  תאריך אסמכתא
              lastDay,          // C  תאריך ערך
              debitAccount,     // D  חן חובה
              revenueAccount,   // E  חן זכות 1 (honours Natanzon override)
              VAT_ACCOUNT,      // F  חן זכות 2
              amount,           // G  סכום חובה
              0,                // H  סכום זכות 1 (replaced with formula below)
              0,                // I  סכום זכות 2 (replaced with formula below)
              DETAILS_MEALS,    // J  פרטים = "ארוחות"
              allocationNumber, // K  מספר הקצאה
            ],
            vatSplit: true,
          },
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
      "אסמתכא 2", // Reut's sample typo preserved
      "תאריך אסמכתא",
      "תאריך ערך",
      "חן חובה",
      "חן זכות 1",
      "חן זכות 2",
      "סכום חובה",
      "סכום זכות 1",
      "סכום זכות 2",
      "פרטים",
      "מספר הקצאה",
    ];
    const ws = XLSX.utils.aoa_to_sheet(
      [headers, ...rows.map((r) => r.cells)],
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
      const meta = rows[r - 1];

      if (meta.vatSplit) {
        // Cached values so the sheet renders correctly before Excel recalcs.
        const gross = meta.cells[6] as number;
        const vat = (gross * VAT_RATE) / (1 + VAT_RATE);
        const preVat = gross - vat;

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
    const lastRow = rows.length + 1;
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
