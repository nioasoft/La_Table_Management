import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import type { ExportRow } from "@/data-access/client-reconciliation-approval";
import {
  loadJournalEntriesData,
  type JournalEntriesData,
  type JournalEntriesParams,
} from "@/lib/hashavshevet/builders/journal-entries";
import { GET } from "../route";

/**
 * Characterization of the franchisee journal-entries Excel export. The DB is
 * mocked at loadJournalEntriesData; everything after the load (the
 * journalEntryGeneration / TENBIS filter, אסמכתא 2, accounts, the HEVER two-row
 * split, the VAT formulas, the workbook) runs for real. Expected values pin what
 * the route produced before the row builder was extracted.
 */

vi.mock("@/lib/api-middleware", () => ({
  isAuthError: () => false,
  requireAdminOrSuperUser: async () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/db", () => ({ database: {} }));
vi.mock("@/lib/hashavshevet/builders/journal-entries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hashavshevet/builders/journal-entries")>()),
  loadJournalEntriesData: vi.fn(),
}));

const SHEET = "ייבוא חשבשבת";
const HEADER = [
  "אסמתכא 2",
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
const SEP_30 = "30/09/2026";

/** The franchisee row. hashavshevetCompanyId is carried for the API path; the Excel ignores it. */
interface Franchisee {
  name: string;
  hashavshevetRevenueAccount: string | null;
  hashavshevetCompanyId?: string | null;
}

const FRANCHISEE: Franchisee = { name: "ויני חדרה", hashavshevetRevenueAccount: null, hashavshevetCompanyId: "company-vini" };

/** One approved reconciliation row of a journal-entry client; the debit account resolves to `חן <code>`. */
function approved(code: string, clientAmount: number, over: Partial<ExportRow> = {}): ExportRow {
  return {
    clientId: `c-${code}`,
    clientCode: code,
    clientName: `שם ${code}`,
    hashavshevetCode: null,
    hashavshevetName: `חן ${code}`,
    hashavshevetByBrand: null,
    franchiseeBrandId: "b-vini",
    accountKey: `לא בשימוש ${code}`,
    clientItemKey: null,
    invoiceGeneration: false,
    journalEntryGeneration: true,
    clientAmount,
    tabitAmount: clientAmount,
    netAmount: null,
    invoiceNumber: null,
    allocationNumber: null,
    approvedAt: new Date("2026-09-10T00:00:00Z"),
    ...over,
  };
}

const load = vi.mocked(loadJournalEntriesData);

function givenData({ franchisee = FRANCHISEE, approved: rows = [] }: { franchisee?: Franchisee | null; approved?: ExportRow[] }): void {
  load.mockImplementation(
    async (params: JournalEntriesParams) => ({ ...params, franchisee, approved: rows }) as JournalEntriesData,
  );
}

function request(query: Record<string, string | undefined> = {}): NextRequest {
  const merged: Record<string, string | undefined> = { franchiseeId: "fr-1", periodMonth: "9", periodYear: "2026", ...query };
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) if (value !== undefined) qs.set(key, value);
  return new NextRequest(`http://localhost/api/reports/hashavshevet/franchisee-journal-entries-export?${qs}`);
}

async function workbook(query: Record<string, string | undefined> = {}): Promise<XLSX.WorkBook> {
  const response = await GET(request(query));
  expect(response.status).toBe(200);
  const wb = XLSX.read(Buffer.from(await response.arrayBuffer()), { cellNF: true, cellFormula: true });
  expect(wb.SheetNames).toEqual([SHEET]);
  return wb;
}

/**
 * The sheet as `sheet_to_json(..., {header:1})`, with the two date columns as their
 * formatted text: the stored serial depends on the machine's time zone.
 */
async function exportRows(query: Record<string, string | undefined> = {}): Promise<unknown[][]> {
  const ws = (await workbook(query)).Sheets[SHEET];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
  const text = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });
  return raw.map((row, r) => (r === 0 ? row : Object.assign([...row], { 1: text[r][1], 2: text[r][2] })));
}

/** Data rows only. */
async function dataRows(query: Record<string, string | undefined> = {}): Promise<unknown[][]> {
  return (await exportRows(query)).slice(1);
}

/** The cached value the route stores for a VAT-split row: [H, I]. */
function split(gross: number): [number, number] {
  const vat = (gross * 0.18) / 1.18;
  return [gross - vat, vat];
}

async function expectError(status: number, error: string, query: Record<string, string | undefined> = {}): Promise<void> {
  const response = await GET(request(query));
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
}

beforeEach(() => {
  load.mockReset();
});

describe("GET /api/reports/hashavshevet/franchisee-journal-entries-export", () => {
  describe("errors", () => {
    it.each([
      ["franchiseeId", { franchiseeId: undefined }],
      ["periodMonth", { periodMonth: undefined }],
      ["periodYear", { periodYear: undefined }],
      ["a non-numeric periodMonth", { periodMonth: "sept" }],
      ["an empty periodYear", { periodYear: "" }],
    ])("rejects a request without %s before loading anything", async (_name, query) => {
      await expectError(400, "נדרשים franchiseeId, periodMonth, periodYear", query);
      expect(load).not.toHaveBeenCalled();
    });

    it("answers 404 when the franchisee does not exist", async () => {
      givenData({ franchisee: null, approved: [approved("WOLT", 1000)] });
      await expectError(404, "זכיין לא נמצא");
    });

    it.each([
      ["no approved row at all", []],
      ["no client flagged for journal entries", [approved("CIBUS", 1000, { journalEntryGeneration: false, invoiceGeneration: true })]],
      ["only TENBIS, before July 2026", [approved("TENBIS", 1000)]],
    ])("answers 400 when there is %s", async (_name, rows) => {
      givenData({ approved: rows });
      await expectError(400, "אין לקוחות עם הפקת פקודת יומן מסומנת בתקופה זו", { periodMonth: "6" });
    });

    it("answers 400 when every amount is zero (WOLT net 0 and HEVER 0 included)", async () => {
      givenData({
        approved: [
          approved("MISHLOCHA", 0),
          approved("WOLT", 500, { netAmount: 0 }),
          approved("HEVER", 0),
          approved("HAAT", -0),
        ],
      });
      await expectError(400, "אין סכומים לייצוא (כל הסכומים אפס)");
    });

    it("answers 500 with a generic Hebrew message when the load fails", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      load.mockRejectedValue(new Error("connection reset"));
      await expectError(500, "שגיאה בייצוא לחשבשבת");
      spy.mockRestore();
    });
  });

  describe("query", () => {
    it("passes the franchisee and the numeric period to the loader, parsing leniently", async () => {
      givenData({ approved: [approved("WOLT", 100)] });
      await GET(request({ franchiseeId: "fr-7", periodMonth: "12abc", periodYear: "2025x" }));
      expect(load).toHaveBeenCalledWith({ franchiseeId: "fr-7", periodMonth: 12, periodYear: 2025 });
    });
  });

  describe("which clients are booked", () => {
    it("keeps only clients flagged journalEntryGeneration, in the loader's order", async () => {
      givenData({
        approved: [
          approved("WOLT", 100),
          approved("CIBUS", 200, { journalEntryGeneration: false, invoiceGeneration: true }),
          approved("MISHLOCHA", 300),
        ],
      });
      expect((await dataRows()).map((r) => r[3])).toEqual(["חן WOLT", "חן MISHLOCHA"]);
    });

    it.each([
      ["June 2026", "6", "2026", false],
      ["December 2025", "12", "2025", false],
      ["July 2026", "7", "2026", true],
      ["January 2027", "1", "2027", true],
    ])("TENBIS in %s is booked: %s", async (_name, month, year, booked) => {
      givenData({ approved: [approved("TENBIS", 800), approved("WOLT", 100)] });
      const debits = (await dataRows({ periodMonth: month, periodYear: year })).map((r) => r[3]);
      expect(debits).toEqual(booked ? ["חן TENBIS", "חן WOLT"] : ["חן WOLT"]);
    });
  });

  describe("אסמתכא 2 (column A)", () => {
    it("is the last four digits of the invoice number for MISHLOCHA, HAAT, WOLT and TENBIS, as text", async () => {
      givenData({
        approved: [
          approved("MISHLOCHA", 100, { invoiceNumber: "INV-0012345" }),
          approved("HAAT", 100, { invoiceNumber: "SI-12-34" }),
          approved("WOLT", 100, { invoiceNumber: "123" }),
          approved("TENBIS", 100, { invoiceNumber: "0007" }),
          approved("HAAT", 100, { clientId: "c-haat-2", invoiceNumber: null }),
          approved("WOLT", 100, { clientId: "c-wolt-2", invoiceNumber: "אין" }),
        ],
      });
      const wb = await workbook();
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[SHEET], { header: 1 }).slice(1);
      expect(rows.map((r) => r[0])).toEqual(["2345", "1234", "123", "0007", "", ""]);
      expect(wb.Sheets[SHEET].A5.t).toBe("s");
    });

    it("is 9999 on both HEVER rows, and empty for CIBUS, other clients and a client without a code", async () => {
      givenData({
        approved: [
          approved("HEVER", 1000, { invoiceNumber: null }),
          approved("CIBUS", 100, { invoiceNumber: "777788" }),
          approved("OTHER", 100, { invoiceNumber: "55556666" }),
          approved("NOCODE", 100, { clientCode: null, invoiceNumber: "11112222" }),
        ],
      });
      expect((await dataRows()).map((r) => r[0])).toEqual(["9999", "9999", "", "", ""]);
    });
  });

  describe("accounts (columns D, E, F)", () => {
    it("debits the per-brand override (trimmed), then the Hashavshevet name, then the code, then the client name", async () => {
      givenData({
        approved: [
          approved("A", 100, { hashavshevetByBrand: { "b-vini": "  חן מותג " }, hashavshevetCode: "קוד" }),
          approved("B", 100, { hashavshevetByBrand: { "b-other": "זר", "b-vini": "   " }, hashavshevetCode: "קוד B" }),
          approved("C", 100, { hashavshevetName: null, hashavshevetCode: "קוד C" }),
          approved("D", 100, { hashavshevetName: "", hashavshevetCode: null }),
          approved("E", 100, { hashavshevetByBrand: { "b-vini": "מותג" }, franchiseeBrandId: null }),
        ],
      });
      expect((await dataRows()).map((r) => r[3])).toEqual(["חן מותג", "חן B", "קוד C", "שם D", "חן E"]);
    });

    it("credits הכנסות and מעמעס by default", async () => {
      givenData({ approved: [approved("WOLT", 100)] });
      expect((await dataRows())[0].slice(4, 6)).toEqual(["הכנסות", "מעמעס"]);
    });

    it("credits the franchisee revenue account override, trimmed (e.g. Natanzon -> הכנסותנ), and ignores a blank one", async () => {
      givenData({ franchisee: { ...FRANCHISEE, hashavshevetRevenueAccount: " הכנסותנ " }, approved: [approved("WOLT", 100)] });
      expect((await dataRows())[0][4]).toBe("הכנסותנ");
      givenData({ franchisee: { ...FRANCHISEE, hashavshevetRevenueAccount: "  " }, approved: [approved("WOLT", 100)] });
      expect((await dataRows())[0][4]).toBe("הכנסות");
    });
  });

  describe("amounts (columns G, H, I)", () => {
    it("WOLT uses its net amount when there is one, everyone else the client amount, never rounded", async () => {
      givenData({
        approved: [
          approved("WOLT", 1500.75, { netAmount: 1234.567 }),
          approved("WOLT", 1500.75, { clientId: "c-wolt-2", netAmount: null }),
          approved("MISHLOCHA", 99.999, { netAmount: 50 }),
          approved("TENBIS", -218.18),
        ],
      });
      expect((await dataRows()).map((r) => r[6])).toEqual([1234.567, 1500.75, 99.999, -218.18]);
    });

    it("writes H and I as formulas with cached values on a VAT-split row, numbered per Excel row", async () => {
      givenData({ approved: [approved("WOLT", 100), approved("HAAT", 1234.57)] });
      const ws = (await workbook()).Sheets[SHEET];
      const [h2, i2] = split(100);
      const [h3, i3] = split(1234.57);
      expect(ws.H2).toMatchObject({ t: "n", f: "G2-I2", v: h2, z: "#,##0.00" });
      expect(ws.I2).toMatchObject({ t: "n", f: "G2/1.18*0.18", v: i2, z: "#,##0.00" });
      expect(ws.H3).toMatchObject({ t: "n", f: "G3-I3", v: h3, z: "#,##0.00" });
      expect(ws.I3).toMatchObject({ t: "n", f: "G3/1.18*0.18", v: i3, z: "#,##0.00" });
      expect(ws.G3).toMatchObject({ t: "n", v: 1234.57, z: "#,##0.00" });
    });

    it("drops zero amounts and keeps negative ones", async () => {
      givenData({ approved: [approved("MISHLOCHA", 0), approved("WOLT", 999, { netAmount: 0 }), approved("HAAT", -50)] });
      const rows = await dataRows();
      expect(rows.map((r) => [r[3], r[6], r[7], r[8]])).toEqual([["חן HAAT", -50, ...split(-50)]]);
    });
  });

  describe("rows", () => {
    it("writes a regular row: A..K with the period's last day and the allocation number as text", async () => {
      givenData({ approved: [approved("WOLT", 1000, { netAmount: 900.55, invoiceNumber: "W-778899", allocationNumber: "012345678" })] });
      expect(await exportRows()).toEqual([
        HEADER,
        ["8899", SEP_30, SEP_30, "חן WOLT", "הכנסות", "מעמעס", 900.55, ...split(900.55), "ארוחות", "012345678"],
      ]);
    });

    it("leaves K empty without an allocation number, and keeps a leading zero as a string cell", async () => {
      givenData({ approved: [approved("MISHLOCHA", 100), approved("HAAT", 200, { allocationNumber: "000000001" })] });
      const ws = (await workbook()).Sheets[SHEET];
      expect(ws.K2).toMatchObject({ t: "s", v: "" });
      expect(ws.K3).toMatchObject({ t: "s", v: "000000001" });
    });

    it("replaces HEVER's row with a commission row and a contra row", async () => {
      givenData({
        franchisee: { ...FRANCHISEE, hashavshevetRevenueAccount: "הכנסותנ" },
        approved: [approved("HEVER", 1234.57, { allocationNumber: "012345678", invoiceNumber: "4321" })],
      });
      const commission = -(1234.57 * 0.18);
      expect(await dataRows()).toEqual([
        ["9999", SEP_30, SEP_30, "חן HEVER", "הכנ עמלות חבר", "מעמעס", commission, ...split(commission), "עמלה", "012345678"],
        ["9999", SEP_30, SEP_30, "חן HEVER", "אמריקן", "", 1234.57, 1234.57, undefined, "מיון", ""],
      ]);
    });

    it("writes the HEVER contra row's H as a static number and leaves its I cell out", async () => {
      givenData({ approved: [approved("WOLT", 10), approved("HEVER", 500)] });
      const ws = (await workbook()).Sheets[SHEET];
      expect(ws.H3).toMatchObject({ t: "n", f: "G3-I3" });
      expect(ws.H4).toEqual({ t: "n", v: 500, w: "500.00", z: "#,##0.00" });
      expect(ws.I4).toBeUndefined();
      expect(ws.F4).toMatchObject({ t: "s", v: "" });
      expect(ws.K4).toMatchObject({ t: "s", v: "" });
    });

    it("dates B and C at the last day of the period month", async () => {
      givenData({ approved: [approved("WOLT", 10)] });
      for (const [month, year, text] of [["2", "2028", "29/02/2028"], ["2", "2026", "28/02/2026"], ["12", "2026", "31/12/2026"]]) {
        const ws = (await workbook({ periodMonth: month, periodYear: year })).Sheets[SHEET];
        expect(ws.B2).toMatchObject({ t: "n", z: "dd/mm/yyyy", w: text });
        expect(ws.C2).toMatchObject({ t: "n", z: "dd/mm/yyyy", w: text });
      }
    });
  });

  describe("workbook and response", () => {
    it("sends an xlsx with the named range over A..K, column widths and the content type", async () => {
      givenData({ approved: [approved("WOLT", 100), approved("HEVER", 200), approved("MISHLOCHA", 0)] });
      const response = await GET(request());
      expect(response.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const wb = XLSX.read(Buffer.from(await response.arrayBuffer()), { cellStyles: true });
      expect(wb.Workbook?.Names?.find((n) => n.Name === "תנועות")?.Ref).toBe("'ייבוא חשבשבת'!$A$1:$K$4");
      expect(wb.Sheets[SHEET]["!cols"]?.map((c) => c.wch)).toEqual([12, 14, 14, 20, 14, 14, 14, 14, 14, 20, 14]);
      expect(wb.Sheets[SHEET]["!ref"]).toBe("A1:K4");
    });

    it("always uses the fixed filename Hashavshevet expects", async () => {
      givenData({ approved: [approved("WOLT", 100)] });
      const response = await GET(request({ franchiseeId: "fr-9", periodMonth: "3" }));
      expect(response.headers.get("Content-Disposition")).toBe(
        `attachment; filename*=UTF-8''${encodeURIComponent("לקוחות תנועות יומן.xlsx")}`,
      );
    });
  });
});
