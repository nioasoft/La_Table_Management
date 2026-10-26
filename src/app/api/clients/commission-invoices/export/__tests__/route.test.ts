import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import type { CommissionInvoiceExportRow } from "@/data-access/commission-invoices";
import {
  loadClientCommissionInvoicesData,
  type ClientCommissionInvoicesData,
  type ClientCommissionInvoicesParams,
} from "@/lib/hashavshevet/builders/client-commission-invoices";
import { GET } from "../route";

/**
 * Characterization of the client commission-invoices Excel export. The DB is
 * mocked at loadClientCommissionInvoicesData (the rows and the VAT rate); everything
 * after the load (invoice ref, serial dates, account resolution, the net/VAT split,
 * the workbook) runs for real. Expected values pin what the route produced before
 * the row builder was extracted.
 */

vi.mock("@/lib/api-middleware", () => ({
  isAuthError: () => false,
  requireAdminOrSuperUser: async () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/db", () => ({ database: {} }));
vi.mock("@/lib/hashavshevet/builders/client-commission-invoices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hashavshevet/builders/client-commission-invoices")>()),
  loadClientCommissionInvoicesData: vi.fn(),
}));

const SHEET = "עמלות לקוחות";
const NAMED_RANGE = "עמלות_לקוחות";
const HEADER = [
  "אסמתכא 2",
  "תאריך אסמכתא",
  "תאריך ערך",
  "חן חובה 1",
  "חוז חובה 2",
  "חן זכות",
  "סכום חובה",
  "סכום חובה 2",
  "סכום זכות 2",
  "פרטים",
  "מספר הקצאה",
];
/** Excel serial of 30/09/2026. */
const SEP_30_2026 = 46295;

/**
 * One commission_invoice document with its client. The company id is carried for the API
 * path (the Excel ignores it), hence the cast: the row type only gains it with the builder.
 */
function invoice(over: Partial<CommissionInvoiceExportRow> = {}): CommissionInvoiceExportRow {
  return {
    invoiceDocumentId: "doc-1",
    invoiceNumber: null,
    allocationNumber: null,
    totalAmountWithVat: 1180,
    periodMonth: 9,
    periodYear: 2026,
    clientId: "c-1",
    clientName: "שם לקוח",
    clientHashavshevet: {
      name: "שם לקוח",
      hashavshevetCode: null,
      hashavshevetName: "חן לקוח",
      hashavshevetByBrand: null,
    },
    franchiseeId: "fr-1",
    franchiseeName: "ויני חדרה",
    brandId: "b-vini",
    franchiseeHashavshevetCompanyId: "company-vini",
    ...over,
  } as CommissionInvoiceExportRow;
}

const load = vi.mocked(loadClientCommissionInvoicesData);

function givenData(rows: CommissionInvoiceExportRow[], vatRate = 0.18): void {
  load.mockImplementation(
    async (params: ClientCommissionInvoicesParams) =>
      ({ periodMonth: params.periodMonth, periodYear: params.periodYear, rows, vatRate }) as ClientCommissionInvoicesData,
  );
}

function request(query: Record<string, string | undefined> = {}): NextRequest {
  const merged: Record<string, string | undefined> = { periodMonth: "9", periodYear: "2026", ...query };
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) if (value !== undefined) qs.set(key, value);
  return new NextRequest(`http://localhost/api/clients/commission-invoices/export?${qs}`);
}

async function workbook(query: Record<string, string | undefined> = {}): Promise<XLSX.WorkBook> {
  const response = await GET(request(query));
  expect(response.status).toBe(200);
  const wb = XLSX.read(Buffer.from(await response.arrayBuffer()), { cellNF: true, cellStyles: true });
  expect(wb.SheetNames).toEqual([SHEET]);
  return wb;
}

/** The sheet as `sheet_to_json(..., {header:1})`. */
async function exportRows(query: Record<string, string | undefined> = {}): Promise<unknown[][]> {
  const ws = (await workbook(query)).Sheets[SHEET];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
}

/** Data rows only. */
async function dataRows(query: Record<string, string | undefined> = {}): Promise<unknown[][]> {
  return (await exportRows(query)).slice(1);
}

async function expectError(status: number, error: string, query: Record<string, string | undefined> = {}): Promise<void> {
  const response = await GET(request(query));
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
}

const cents = (n: number) => Math.round(n * 100);

beforeEach(() => {
  load.mockReset();
});

describe("GET /api/clients/commission-invoices/export", () => {
  describe("errors", () => {
    it.each([
      ["periodMonth", { periodMonth: undefined }],
      ["periodYear", { periodYear: undefined }],
      ["a non-numeric periodMonth", { periodMonth: "sept" }],
      ["an empty periodYear", { periodYear: "" }],
      ["month 0", { periodMonth: "0" }],
      ["month 13", { periodMonth: "13" }],
      ["year 1999", { periodYear: "1999" }],
      ["year 2101", { periodYear: "2101" }],
    ])("rejects %s before loading anything", async (_name, query) => {
      await expectError(400, "periodMonth/periodYear לא תקינים", query);
      expect(load).not.toHaveBeenCalled();
    });

    it("answers 400 when the period has no commission invoice", async () => {
      givenData([]);
      await expectError(400, "אין חשבוניות עמלה לתקופה הנבחרת");
    });

    it("answers 500 with a generic Hebrew message when the load fails", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      load.mockRejectedValue(new Error("connection reset"));
      await expectError(500, "שגיאה בייצוא הקובץ");
      spy.mockRestore();
    });
  });

  describe("query", () => {
    it("passes the numeric period and the franchisee filter to the loader, parsing leniently", async () => {
      givenData([invoice()]);
      await GET(request({ periodMonth: "12abc", periodYear: "2025x", franchiseeId: "fr-7" }));
      expect(load).toHaveBeenCalledWith({ periodMonth: 12, periodYear: 2025, franchiseeId: "fr-7" });
    });

    it("passes a null franchisee for a missing or empty franchiseeId (every franchisee)", async () => {
      givenData([invoice()]);
      await GET(request());
      await GET(request({ franchiseeId: "" }));
      expect(load).toHaveBeenNthCalledWith(1, { periodMonth: 9, periodYear: 2026, franchiseeId: null });
      expect(load).toHaveBeenNthCalledWith(2, { periodMonth: 9, periodYear: 2026, franchiseeId: null });
    });

    it("keeps the loader's order", async () => {
      givenData([
        invoice({ invoiceNumber: "3333" }),
        invoice({ invoiceNumber: "1111", invoiceDocumentId: "doc-2" }),
        invoice({ invoiceNumber: "2222", invoiceDocumentId: "doc-3" }),
      ]);
      expect((await dataRows()).map((r) => r[0])).toEqual(["3333", "1111", "2222"]);
    });
  });

  describe("אסמתכא 2 (column A)", () => {
    it("is the last four digits of the invoice number, as text", async () => {
      givenData([
        invoice({ invoiceNumber: "INV-0012345" }),
        invoice({ invoiceNumber: "SI-12-34" }),
        invoice({ invoiceNumber: "123" }),
        invoice({ invoiceNumber: "0007" }),
        invoice({ invoiceNumber: "98765432" }),
      ]);
      const wb = await workbook();
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[SHEET], { header: 1 }).slice(1);
      expect(rows.map((r) => r[0])).toEqual(["2345", "1234", "123", "0007", "5432"]);
      expect(wb.Sheets[SHEET].A5).toMatchObject({ t: "s", v: "0007" });
    });

    it("falls back to the last four characters of a number without digits, and is empty without a number", async () => {
      givenData([
        invoice({ invoiceNumber: "ABCDEFG" }),
        invoice({ invoiceNumber: "אין" }),
        invoice({ invoiceNumber: null }),
        invoice({ invoiceNumber: "" }),
      ]);
      const ws = (await workbook()).Sheets[SHEET];
      expect([ws.A2.v, ws.A3.v, ws.A4.v, ws.A5.v]).toEqual(["DEFG", "אין", "", ""]);
      expect(ws.A4.t).toBe("s");
    });
  });

  describe("dates (columns B, C)", () => {
    it("are the Excel serial of the period's last day, formatted dd/mm/yyyy", async () => {
      givenData([invoice()]);
      for (const [month, year, serial, text] of [
        ["9", "2026", SEP_30_2026, "30/09/2026"],
        ["2", "2028", 46812, "29/02/2028"], // leap February
        ["2", "2026", 46081, "28/02/2026"],
        ["12", "2026", 46387, "31/12/2026"],
        ["1", "2026", 46053, "31/01/2026"],
        ["6", "2025", 45838, "30/06/2025"],
      ] as const) {
        const ws = (await workbook({ periodMonth: month, periodYear: year })).Sheets[SHEET];
        for (const cell of [ws.B2, ws.C2]) expect(cell).toMatchObject({ t: "n", v: serial, z: "dd/mm/yyyy", w: text });
      }
    });
  });

  describe("accounts (columns D, E, F)", () => {
    it("debits עמלות מלקוחות and מעמתש on every row", async () => {
      givenData([invoice(), invoice({ invoiceDocumentId: "doc-2" })]);
      expect((await dataRows()).map((r) => r.slice(3, 5))).toEqual([
        ["עמלות מלקוחות", "מעמתש"],
        ["עמלות מלקוחות", "מעמתש"],
      ]);
    });

    it("credits the per-brand override (trimmed), then the code, then the name, then the client name", async () => {
      const client = (over: Partial<CommissionInvoiceExportRow["clientHashavshevet"]>) => ({
        name: "שם לקוח",
        hashavshevetCode: null,
        hashavshevetName: null,
        hashavshevetByBrand: null,
        ...over,
      });
      givenData([
        invoice({ clientHashavshevet: client({ hashavshevetByBrand: { "b-vini": "  חן מותג " }, hashavshevetCode: "קוד", hashavshevetName: "שם חן" }) }),
        invoice({ clientHashavshevet: client({ hashavshevetByBrand: { "b-other": "זר" }, hashavshevetCode: "קוד B", hashavshevetName: "שם חן" }) }),
        invoice({ clientHashavshevet: client({ hashavshevetByBrand: { "b-vini": "   " }, hashavshevetCode: "קוד C" }) }),
        invoice({ clientHashavshevet: client({ hashavshevetName: "שם D" }) }),
        invoice({ clientHashavshevet: client({ hashavshevetCode: "", hashavshevetName: "" }) }),
        invoice({ brandId: null, clientHashavshevet: client({ hashavshevetByBrand: { "b-vini": "מותג" }, hashavshevetCode: "קוד F" }) }),
      ]);
      expect((await dataRows()).map((r) => r[5])).toEqual(["חן מותג", "קוד B", "קוד C", "שם D", "שם לקוח", "קוד F"]);
    });

    it("resolves the override against each row's own brand", async () => {
      const byBrand = { "b-vini": "חשבון ויני", "b-mina": "חשבון מינה" };
      const client = { name: "גיפט", hashavshevetCode: "GIFT", hashavshevetName: null, hashavshevetByBrand: byBrand };
      givenData([
        invoice({ brandId: "b-vini", clientHashavshevet: client }),
        invoice({ brandId: "b-mina", clientHashavshevet: client }),
        invoice({ brandId: "b-king", clientHashavshevet: client }),
      ]);
      expect((await dataRows()).map((r) => r[5])).toEqual(["חשבון ויני", "חשבון מינה", "GIFT"]);
    });
  });

  describe("amounts (columns G, H, I)", () => {
    it.each([
      [0.18, 1234.57, 1046.25, 188.32],
      [0.18, 0.05, 0.04, 0.01],
      [0.18, 99.99, 84.74, 15.25],
      [0.18, 1180, 1000, 180],
      [0.18, 0.01, 0.01, 0],
      [0.18, 1000, 847.46, 152.54],
      [0.17, 1234.57, 1055.19, 179.38],
      [0.17, 0.05, 0.04, 0.01],
      [0.17, 99.99, 85.46, 14.53],
      [0.17, 1180, 1008.55, 171.45],
      [0.17, 1000, 854.7, 145.3],
    ])("at VAT %s a total of %s is split into net %s and VAT %s", async (vatRate, total, net, vat) => {
      givenData([invoice({ totalAmountWithVat: total })], vatRate);
      const [row] = await dataRows();
      expect(row.slice(6, 9)).toEqual([net, vat, total]);
    });

    it("rounds the total itself to two decimals before splitting it", async () => {
      givenData([invoice({ totalAmountWithVat: 1234.5678 }), invoice({ totalAmountWithVat: 100.005 }), invoice({ totalAmountWithVat: 2.675 })]);
      expect((await dataRows()).map((r) => r.slice(6, 9))).toEqual([
        [1046.25, 188.32, 1234.57],
        [84.75, 15.26, 100.01],
        [2.27, 0.41, 2.68],
      ]);
    });

    it("uses the VAT rate the loader returned", async () => {
      givenData([invoice({ totalAmountWithVat: 1170 })], 0.17);
      expect((await dataRows())[0].slice(6, 9)).toEqual([1000, 170, 1170]);
      givenData([invoice({ totalAmountWithVat: 1170 })], 0);
      expect((await dataRows())[0].slice(6, 9)).toEqual([1170, 0, 1170]);
    });

    it.each([0.18, 0.17])("balances to the agora at VAT %s: G + H equals I for every total", async (vatRate) => {
      const totals: number[] = [0.01, 0.05, 0.99, 1.17, 1.18, 99.99, 1234.57, 4999.995];
      for (let c = 1; c <= 2_000_000; c += 4999) totals.push(c / 100);
      givenData(
        totals.map((total, n) => invoice({ totalAmountWithVat: total, invoiceDocumentId: `doc-${n}` })),
        vatRate,
      );
      for (const [, , , , , , g, h, i] of await dataRows()) {
        expect(cents(g as number) + cents(h as number), `I=${i}`).toBe(cents(i as number));
      }
    });

    it("writes G, H and I as money cells", async () => {
      givenData([invoice({ totalAmountWithVat: 1234.57 })]);
      const ws = (await workbook()).Sheets[SHEET];
      for (const addr of ["G2", "H2", "I2"]) expect(ws[addr]).toMatchObject({ t: "n", z: "#,##0.00" });
      expect([ws.G2.v, ws.H2.v, ws.I2.v]).toEqual([1046.25, 188.32, 1234.57]);
    });
  });

  describe("פרטים (column J)", () => {
    it.each([
      [1, "ינואר"],
      [2, "פברואר"],
      [3, "מרץ"],
      [4, "אפריל"],
      [5, "מאי"],
      [6, "יוני"],
      [7, "יולי"],
      [8, "אוגוסט"],
      [9, "ספטמבר"],
      [10, "אוקטובר"],
      [11, "נובמבר"],
      [12, "דצמבר"],
    ])("is עמלה plus the Hebrew name of month %s", async (month, name) => {
      givenData([invoice()]);
      expect((await dataRows({ periodMonth: String(month) }))[0][9]).toBe(`עמלה ${name}`);
    });
  });

  describe("מספר הקצאה (column K)", () => {
    it("is the allocation number as text, keeping a leading zero, and empty without one", async () => {
      givenData([
        invoice({ allocationNumber: "012345678" }),
        invoice({ allocationNumber: "000000001" }),
        invoice({ allocationNumber: null }),
      ]);
      const ws = (await workbook()).Sheets[SHEET];
      expect(ws.K2).toMatchObject({ t: "s", v: "012345678" });
      expect(ws.K3).toMatchObject({ t: "s", v: "000000001" });
      expect(ws.K4).toMatchObject({ t: "s", v: "" });
    });
  });

  describe("rows", () => {
    it("writes a full row A..K", async () => {
      givenData([invoice({ invoiceNumber: "INV-778899", allocationNumber: "012345678", totalAmountWithVat: 1234.57 })]);
      expect(await exportRows()).toEqual([
        HEADER,
        ["8899", SEP_30_2026, SEP_30_2026, "עמלות מלקוחות", "מעמתש", "חן לקוח", 1046.25, 188.32, 1234.57, "עמלה ספטמבר", "012345678"],
      ]);
    });

    it("writes one row per document, even when the same client and franchisee have two", async () => {
      givenData([
        invoice({ invoiceDocumentId: "doc-1", invoiceNumber: "1001", totalAmountWithVat: 100 }),
        invoice({ invoiceDocumentId: "doc-2", invoiceNumber: "1002", totalAmountWithVat: 200 }),
      ]);
      expect((await dataRows()).map((r) => [r[0], r[8]])).toEqual([["1001", 100], ["1002", 200]]);
    });
  });

  describe("workbook and response", () => {
    it("sends an xlsx named by the Hashavshevet range over A..K, with column widths and the content type", async () => {
      givenData([invoice(), invoice({ invoiceDocumentId: "doc-2" }), invoice({ invoiceDocumentId: "doc-3" })]);
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const wb = XLSX.read(Buffer.from(await response.arrayBuffer()), { cellStyles: true });
      expect(wb.Workbook?.Names?.find((n) => n.Name === NAMED_RANGE)?.Ref).toBe(`'${SHEET}'!$A$1:$K$4`);
      expect(wb.Sheets[SHEET]["!cols"]?.map((c) => c.wch)).toEqual([10, 14, 14, 18, 14, 28, 12, 12, 12, 18, 14]);
      expect(wb.Sheets[SHEET]["!ref"]).toBe("A1:K4");
    });

    it("always uses the fixed filename the accountant imports", async () => {
      givenData([invoice()]);
      const response = await GET(request({ periodMonth: "3", franchiseeId: "fr-9" }));
      expect(response.headers.get("Content-Disposition")).toBe(
        `attachment; filename*=UTF-8''${encodeURIComponent("עמלות לקוחות.xlsx")}`,
      );
    });
  });
});
