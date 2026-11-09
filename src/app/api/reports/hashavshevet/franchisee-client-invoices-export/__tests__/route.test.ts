import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import type { ExportRow } from "@/data-access/client-reconciliation-approval";
import type { OccasionalClientExportRow } from "@/data-access/occasional-clients";
import {
  loadFranchiseeClientInvoicesData,
  type FranchiseeClientInvoicesData,
  type FranchiseeClientInvoicesParams,
} from "@/lib/hashavshevet/builders/franchisee-client-invoices";
import { GET } from "../route";

/**
 * Characterization of the franchisee client-invoices Excel export. The DB is
 * mocked at loadFranchiseeClientInvoicesData; everything after the load (the
 * invoiceGeneration / TENBIS filter, item key and discount rules, rounding,
 * numbering, workbook) runs for real. Expected values pin what the route
 * produced before the row builder was extracted.
 */

vi.mock("@/lib/api-middleware", () => ({
  isAuthError: () => false,
  requireAdminOrSuperUser: async () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/db", () => ({ database: {} }));
vi.mock("@/lib/hashavshevet/builders/franchisee-client-invoices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hashavshevet/builders/franchisee-client-invoices")>()),
  loadFranchiseeClientInvoicesData: vi.fn(),
}));

const SHEET = "ייבוא חשבשבת";
const HEADER = [
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

/** The franchisee row. hashavshevetCompanyId is carried for the API path; the Excel ignores it. */
interface Franchisee {
  name: string;
  hashavshevetRevenueAccount: string | null;
  hashavshevetCompanyId: string | null;
}

const FRANCHISEE: Franchisee = {
  name: "ויני חדרה",
  hashavshevetRevenueAccount: null,
  hashavshevetCompanyId: "company-vini",
};

/** One approved reconciliation row; `accountKey` / `clientItemKey` arrive already resolved by the data-access layer. */
function approved(code: string, clientAmount: number, over: Partial<ExportRow> = {}): ExportRow {
  return {
    clientId: `c-${code}`,
    clientCode: code,
    clientName: code,
    hashavshevetCode: null,
    hashavshevetName: null,
    hashavshevetByBrand: null,
    franchiseeBrandId: "b-vini",
    accountKey: `חשבון ${code}`,
    clientItemKey: null,
    invoiceGeneration: true,
    journalEntryGeneration: false,
    clientAmount,
    tabitAmount: clientAmount,
    netAmount: null,
    invoiceNumber: null,
    allocationNumber: null,
    approvedAt: new Date("2026-09-10T00:00:00Z"),
    ...over,
  };
}

function occasional(name: string, totalAmount: number): OccasionalClientExportRow {
  return { occasionalClientId: `o-${name}`, tabitColumnName: name, hashavshevetName: `מזדמן ${name}`, totalAmount };
}

const load = vi.mocked(loadFranchiseeClientInvoicesData);

interface Given {
  franchisee?: Franchisee | null;
  approved?: ExportRow[];
  occasional?: OccasionalClientExportRow[];
}

function givenData({ franchisee = FRANCHISEE, approved: rows = [], occasional: occ = [] }: Given): void {
  load.mockImplementation(
    async (params: FranchiseeClientInvoicesParams) =>
      ({ ...params, franchisee, approved: rows, occasional: occ }) as FranchiseeClientInvoicesData,
  );
}

function request(query: Record<string, string | undefined> = {}): NextRequest {
  const merged: Record<string, string | undefined> = {
    franchiseeId: "fr-1",
    periodMonth: "9",
    periodYear: "2026",
    ...query,
  };
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) if (value !== undefined) qs.set(key, value);
  return new NextRequest(`http://localhost/api/reports/hashavshevet/franchisee-client-invoices-export?${qs}`);
}

async function exportRows(query: Record<string, string | undefined> = {}): Promise<unknown[][]> {
  const response = await GET(request(query));
  expect(response.status).toBe(200);
  const wb = XLSX.read(Buffer.from(await response.arrayBuffer()));
  expect(wb.SheetNames).toEqual([SHEET]);
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[SHEET], { header: 1 });
}

/** Data rows only: [account, itemKey, price, discount, documentNumber]. */
async function summary(query: Record<string, string | undefined> = {}): Promise<unknown[][]> {
  return (await exportRows(query)).slice(1).map((r) => [r[0], r[2], r[5], r[6], r[8]]);
}

beforeEach(() => {
  load.mockReset();
});

describe("GET /api/reports/hashavshevet/franchisee-client-invoices-export", () => {
  describe("errors", () => {
    it.each([
      ["franchiseeId", { franchiseeId: undefined }],
      ["periodMonth", { periodMonth: undefined }],
      ["periodYear", { periodYear: undefined }],
      ["a non-numeric periodMonth", { periodMonth: "sept" }],
      ["a non-numeric periodYear", { periodYear: "" }],
    ])("rejects a request without %s before loading anything", async (_name, query) => {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "נדרשים franchiseeId, periodMonth, periodYear" });
      expect(load).not.toHaveBeenCalled();
    });

    it("answers 404 when the franchisee does not exist", async () => {
      givenData({ franchisee: null, approved: [approved("CIBUS", 1000)] });
      const response = await GET(request());
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "זכיין לא נמצא" });
    });

    it("answers 400 when no client is flagged for invoice generation and there are no occasional rows", async () => {
      givenData({ approved: [approved("WOLT", 1000, { invoiceGeneration: false })] });
      const response = await GET(request());
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "אין לקוחות עם הפקת חשבונית מסומנת בתקופה זו" });
    });

    it("answers 400 when there is no approved row at all", async () => {
      givenData({});
      const response = await GET(request());
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "אין לקוחות עם הפקת חשבונית מסומנת בתקופה זו" });
    });

    it("answers 400 when every amount is zero after rounding", async () => {
      givenData({ approved: [approved("CIBUS", 0), approved("TENBIS", 0.4)], occasional: [occasional("א", 0.2)] });
      const response = await GET(request());
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "אין סכומים לייצוא (כל הסכומים אפס)" });
    });

    it("answers 500 with a generic Hebrew message when the load fails", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      load.mockRejectedValue(new Error("connection reset"));
      const response = await GET(request());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "שגיאה בייצוא לחשבשבת" });
      spy.mockRestore();
    });
  });

  describe("query", () => {
    it("passes the franchisee and the numeric period to the loader", async () => {
      givenData({ approved: [approved("CIBUS", 1000)] });
      await GET(request({ franchiseeId: "fr-7", periodMonth: "12", periodYear: "2025" }));
      expect(load).toHaveBeenCalledWith({ franchiseeId: "fr-7", periodMonth: 12, periodYear: 2025 });
    });

    it("parses the period leniently (parseInt): a numeric prefix is accepted", async () => {
      givenData({ approved: [approved("CIBUS", 1000)] });
      await GET(request({ periodMonth: "9abc", periodYear: "2026x" }));
      expect(load).toHaveBeenCalledWith({ franchiseeId: "fr-1", periodMonth: 9, periodYear: 2026 });
    });
  });

  describe("which clients are invoiced", () => {
    it("keeps only clients flagged invoiceGeneration, in the loader's order", async () => {
      givenData({
        approved: [
          approved("CIBUS", 1000),
          approved("WOLT", 500, { invoiceGeneration: false }),
          approved("GIFTCARD", 300),
        ],
      });
      expect(await summary()).toEqual([
        ["חשבון CIBUS", "ארוחות", 1000, 15.2543, 1],
        ["חשבון GIFTCARD", "גיפט", 300, 19.2543, 2],
      ]);
    });

    it.each([
      ["June 2026", "6", "2026"],
      ["December 2025", "12", "2025"],
      ["January 2024", "1", "2024"],
    ])("includes TENBIS even without the flag before July 2026 (%s)", async (_name, month, year) => {
      givenData({ approved: [approved("TENBIS", 800, { invoiceGeneration: false })] });
      expect(await summary({ periodMonth: month, periodYear: year })).toEqual([
        ["חשבון TENBIS", "ארוחות", 800, 15.2543, 1],
      ]);
    });

    it.each([
      ["July 2026", "7", "2026"],
      ["December 2026", "12", "2026"],
      ["January 2027", "1", "2027"],
    ])("excludes unflagged TENBIS from July 2026 on (%s)", async (_name, month, year) => {
      givenData({
        approved: [approved("TENBIS", 800, { invoiceGeneration: false }), approved("CIBUS", 100)],
      });
      expect(await summary({ periodMonth: month, periodYear: year })).toEqual([
        ["חשבון CIBUS", "ארוחות", 100, 15.2543, 1],
      ]);
    });

    it("keeps TENBIS from July 2026 on when the client itself is flagged", async () => {
      givenData({ approved: [approved("TENBIS", 800)] });
      expect(await summary({ periodMonth: "8", periodYear: "2026" })).toEqual([
        ["חשבון TENBIS", "ארוחות", 800, 15.2543, 1],
      ]);
    });

    it("answers 400 for an unflagged TENBIS alone from July 2026 on", async () => {
      givenData({ approved: [approved("TENBIS", 800, { invoiceGeneration: false })] });
      const response = await GET(request({ periodMonth: "7", periodYear: "2026" }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "אין לקוחות עם הפקת חשבונית מסומנת בתקופה זו" });
    });
  });

  describe("item key (מפתח פריט) precedence", () => {
    it("GIFTCARD always uses its own item, over the client key and the franchisee override", async () => {
      givenData({
        franchisee: { ...FRANCHISEE, hashavshevetRevenueAccount: "הכנסותנ" },
        approved: [approved("GIFTCARD", 300, { clientItemKey: "ארוחותש" })],
      });
      expect((await summary())[0][1]).toBe("גיפט");
    });

    it("a client item key (per brand or global, e.g. LATABLEMARK) wins over the franchisee override", async () => {
      givenData({
        franchisee: { ...FRANCHISEE, hashavshevetRevenueAccount: "הכנסותנ" },
        approved: [
          approved("LATABLEMARK", 1000, { clientItemKey: "ארוחותש" }),
          approved("CIBUS", 500, { clientItemKey: "ארוחותויני" }),
        ],
      });
      expect((await summary()).map((r) => r[1])).toEqual(["ארוחותש", "ארוחותויני"]);
    });

    it("the franchisee revenue account overrides the default, trimmed (e.g. Natanzon -> הכנסותנ)", async () => {
      givenData({
        franchisee: { ...FRANCHISEE, hashavshevetRevenueAccount: "  הכנסותנ " },
        approved: [approved("CIBUS", 500), approved("TENBIS", 200)],
      });
      expect((await summary()).map((r) => r[1])).toEqual(["הכנסותנ", "הכנסותנ"]);
    });

    it("falls back to ארוחות for an empty client key and a blank or null franchisee account", async () => {
      givenData({
        franchisee: { ...FRANCHISEE, hashavshevetRevenueAccount: "   " },
        approved: [approved("CIBUS", 500, { clientItemKey: "" })],
      });
      expect((await summary())[0][1]).toBe("ארוחות");

      givenData({ approved: [approved("CIBUS", 500)] });
      expect((await summary())[0][1]).toBe("ארוחות");
    });

    it("an occasional client takes the franchisee override, else the default", async () => {
      givenData({
        franchisee: { ...FRANCHISEE, hashavshevetRevenueAccount: "הכנסותנ" },
        occasional: [occasional("א", 100)],
      });
      expect((await summary())[0][1]).toBe("הכנסותנ");

      givenData({ occasional: [occasional("א", 100)] });
      expect((await summary())[0][1]).toBe("ארוחות");
    });
  });

  describe("discount (אחוז הנחה לפריט)", () => {
    it("is 15.2543 by default and 19.2543 for GIFTCARD, for approved and occasional rows", async () => {
      givenData({
        approved: [approved("CIBUS", 100), approved("GIFTCARD", 200), approved("WOLT", 300, { netAmount: 290 })],
        occasional: [occasional("א", 400)],
      });
      expect((await summary()).map((r) => r[3])).toEqual([15.2543, 19.2543, 15.2543, 15.2543]);
    });
  });

  describe("price", () => {
    it("rounds a normal client to whole shekels (Math.round: .5 rounds up, negatives toward zero)", async () => {
      givenData({
        approved: [
          approved("CIBUS", 1234.4),
          approved("SIBUS", 1234.5),
          approved("TENBIS", -100.5),
          approved("HEVER", -100.6),
          approved("GIFTCARD", 99.5),
        ],
      });
      expect((await summary()).map((r) => r[2])).toEqual([1234, 1235, -100, -101, 100]);
    });

    it("halves LATABLE and LATABLEMARK, then rounds", async () => {
      givenData({
        approved: [
          approved("LATABLE", 1001),
          approved("LATABLEMARK", 3, { clientItemKey: "ארוחותש" }),
          approved("LATABLEX", 1001),
          approved("LATABLE_OTHER", 1000.4),
        ],
      });
      // 500.5 -> 501, 1.5 -> 2; only the exact codes LATABLE / LATABLEMARK halve: 1001, 1000.4 -> 1000
      expect((await summary()).map((r) => r[2])).toEqual([501, 2, 1001, 1000]);
    });

    it("WOLT keeps the exact net amount when there is one, else the client amount (no rounding)", async () => {
      givenData({
        approved: [
          approved("WOLT", 1500.75, { netAmount: 1234.56 }),
          approved("WOLT", 1500.75, { clientId: "c-wolt-2", netAmount: null }),
          approved("WOLT", 500, { clientId: "c-wolt-3", netAmount: 0 }), // net 0 is not null: price 0, dropped
        ],
      });
      expect((await summary()).map((r) => r[2])).toEqual([1234.56, 1500.75]);
    });

    it("drops rows whose rounded price is 0 (including a negative -0) and numbers the rest", async () => {
      givenData({
        approved: [approved("CIBUS", 0.4), approved("TENBIS", -0.4), approved("HEVER", 300), approved("LATABLE", 1)],
        occasional: [occasional("א", 0.49), occasional("ב", 50)],
      });
      // LATABLE: 1 / 2 = 0.5 -> 1 (kept)
      expect(await summary()).toEqual([
        ["חשבון HEVER", "ארוחות", 300, 15.2543, 1],
        ["חשבון LATABLE", "ארוחות", 1, 15.2543, 2],
        ["מזדמן ב", "ארוחות", 50, 15.2543, 3],
      ]);
    });
  });

  describe("occasional clients", () => {
    it("come after the approved rows with their Hashavshevet name, rounded, numbering continuing", async () => {
      givenData({
        approved: [approved("CIBUS", 1000)],
        occasional: [occasional("א", 250.5), occasional("ב", 99.4)],
      });
      expect(await summary()).toEqual([
        ["חשבון CIBUS", "ארוחות", 1000, 15.2543, 1],
        ["מזדמן א", "ארוחות", 251, 15.2543, 2],
        ["מזדמן ב", "ארוחות", 99, 15.2543, 3],
      ]);
    });

    it("alone are enough to export when no client is flagged", async () => {
      givenData({ approved: [approved("WOLT", 700, { invoiceGeneration: false })], occasional: [occasional("א", 120)] });
      expect(await summary()).toEqual([["מזדמן א", "ארוחות", 120, 15.2543, 1]]);
    });
  });

  describe("rows", () => {
    it("writes the nine columns: account, empty name, item, empty item name, quantity 1, price, discount, type 11, number", async () => {
      givenData({ approved: [approved("CIBUS", 1234.5), approved("GIFTCARD", 300)] });
      expect(await exportRows()).toEqual([
        HEADER,
        ["חשבון CIBUS", "", "ארוחות", "", 1, 1235, 15.2543, 11, 1],
        ["חשבון GIFTCARD", "", "גיפט", "", 1, 300, 19.2543, 11, 2],
      ]);
    });

    it("exports a Cibus (סיבוס) invoice with the account key the data-access layer resolved", async () => {
      givenData({
        approved: [approved("CIBUS", 18432.6, { clientName: "סיבוס", accountKey: "סיבוס", clientItemKey: null })],
      });
      expect(await exportRows()).toEqual([HEADER, ["סיבוס", "", "ארוחות", "", 1, 18433, 15.2543, 11, 1]]);
    });

    it("numbers the documents 1..N in the loader's order, approved rows first", async () => {
      givenData({
        approved: [approved("B", 20), approved("A", 10), approved("C", 30)],
        occasional: [occasional("ז", 5), occasional("ד", 6)],
      });
      const rows = await exportRows();
      expect(rows.slice(1).map((r) => [r[0], r[8]])).toEqual([
        ["חשבון B", 1],
        ["חשבון A", 2],
        ["חשבון C", 3],
        ["מזדמן ז", 4],
        ["מזדמן ד", 5],
      ]);
    });
  });

  describe("workbook and response", () => {
    it("sends an xlsx with the named range, column widths and numeric formats", async () => {
      givenData({ approved: [approved("CIBUS", 12345), approved("WOLT", 500, { netAmount: 1234.56 })] });
      const response = await GET(request());
      expect(response.headers.get("Content-Type")).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      const wb = XLSX.read(Buffer.from(await response.arrayBuffer()), { cellNF: true, cellStyles: true });
      expect(wb.Workbook?.Names?.find((n) => n.Name === "חוזים")?.Ref).toBe("'ייבוא חשבשבת'!$A$1:$I$3");
      const ws = wb.Sheets[SHEET];
      expect(ws["!cols"]?.map((c) => c.wch)).toEqual([15, 10, 15, 10, 8, 12, 14, 12, 12]);
      expect([ws.E2.t, ws.E2.z]).toEqual(["n", "0"]);
      expect([ws.F2.t, ws.F2.z, ws.F2.v]).toEqual(["n", "#,##0", 12345]);
      expect([ws.G2.t, ws.G2.z, ws.G2.v]).toEqual(["n", "0.0000", 15.2543]);
      expect([ws.H2.t, ws.H2.z]).toEqual(["n", "0"]);
      expect([ws.I2.t, ws.I2.z]).toEqual(["n", "0"]);
      expect(ws.F3.v).toBe(1234.56);
      expect(ws.A2.t).toBe("s");
      expect(ws.C2.t).toBe("s");
    });

    it("extends the named range to the last data row", async () => {
      givenData({ approved: [approved("A", 1), approved("B", 2), approved("C", 3), approved("D", 0)] });
      const response = await GET(request());
      const wb = XLSX.read(Buffer.from(await response.arrayBuffer()));
      expect(wb.Workbook?.Names?.find((n) => n.Name === "חוזים")?.Ref).toBe("'ייבוא חשבשבת'!$A$1:$I$4");
    });

    it("always uses the fixed filename Hashavshevet expects", async () => {
      givenData({ approved: [approved("CIBUS", 1000)] });
      const response = await GET(request({ franchiseeId: "fr-9", periodMonth: "3", periodYear: "2026" }));
      const header = response.headers.get("Content-Disposition") ?? "";
      expect(header).toBe(`attachment; filename*=UTF-8''${encodeURIComponent("לקוחות חשבוניות.xlsx")}`);
      expect(decodeURIComponent(header.replace("attachment; filename*=UTF-8''", ""))).toBe("לקוחות חשבוניות.xlsx");
    });
  });
});
