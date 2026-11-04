import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import {
  loadClientCommissionsData,
  type ClientCommissionsClient,
  type ClientCommissionsData,
  type ClientCommissionsParams,
} from "@/lib/hashavshevet/builders/client-commissions";
import { GET } from "../route";

/**
 * Characterization of the client-commissions Excel export. The DB is mocked at
 * loadClientCommissionsData; everything after the load (zero skip, LA TABLE rule,
 * account resolution, workbook) runs for real. Expected values pin what the route
 * produced before the row builder was extracted.
 */

vi.mock("@/lib/api-middleware", () => ({
  isAuthError: () => false,
  requireAdminOrSuperUser: async () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/db", () => ({ database: {} }));
vi.mock("@/lib/hashavshevet/builders/client-commissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hashavshevet/builders/client-commissions")>()),
  loadClientCommissionsData: vi.fn(),
}));

const SHEET = "ייבוא חשבשבת";
const HEADER = ["מפתח חשבון", "שם", "מפתח פריט", "שם פריט", "כמות", "מחיר", "סוג המסמך", "מספר מסמך"];

const SESSION = { clientId: "c-1", clientName: "גולדה", periodMonth: 9, periodYear: 2026 };

function account(over: Partial<ClientCommissionsClient>): ClientCommissionsClient {
  return {
    code: "GOLDA",
    name: "גולדה",
    hashavshevetCode: null,
    hashavshevetName: null,
    hashavshevetByBrand: null,
    ...over,
  };
}

/** The approved-comparison row. franchiseeId / hashavshevetCompanyId are carried for the API path; the Excel ignores them. */
interface Comp {
  franchiseeId: string;
  hashavshevetCompanyId: string | null;
  franchiseeName: string;
  franchiseeCode: string;
  franchiseeBrandId: string | null;
  clientAmount: string | null;
  commissionAmount: string | null;
  netAmount: string | null;
  actualCommissionRate: string | null;
}

function comp(name: string, netAmount: string | null, over: Partial<Comp> = {}): Comp {
  return {
    franchiseeId: `f-${name}`,
    hashavshevetCompanyId: null,
    franchiseeName: name,
    franchiseeCode: name,
    franchiseeBrandId: "b-vini",
    clientAmount: null,
    commissionAmount: null,
    netAmount,
    actualCommissionRate: null,
    ...over,
  };
}

const load = vi.mocked(loadClientCommissionsData);

interface Given {
  session?: typeof SESSION | null;
  client?: ClientCommissionsClient | null;
  comparisons?: Comp[];
}

function givenData({ session = SESSION, client = account({ hashavshevetCode: "70001" }), comparisons = [] }: Given): void {
  load.mockImplementation(
    async (params: ClientCommissionsParams) => ({ ...params, session, client, comparisons }) as ClientCommissionsData,
  );
}

function request(query: Record<string, string>): NextRequest {
  const qs = new URLSearchParams({ sessionId: "sess-1", ...query });
  return new NextRequest(`http://localhost/api/reports/hashavshevet/client-export?${qs}`);
}

async function exportRows(query: Record<string, string> = {}): Promise<unknown[][]> {
  const response = await GET(request(query));
  expect(response.status).toBe(200);
  const wb = XLSX.read(Buffer.from(await response.arrayBuffer()));
  expect(wb.SheetNames).toEqual([SHEET]);
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[SHEET], { header: 1 });
}

function filenameOf(response: Response): string {
  const header = response.headers.get("Content-Disposition") ?? "";
  return decodeURIComponent(header.replace(/^attachment; filename="/, "").replace(/"$/, ""));
}

beforeEach(() => {
  load.mockReset();
});

describe("GET /api/reports/hashavshevet/client-export", () => {
  describe("errors", () => {
    it("rejects a request without sessionId before loading anything", async () => {
      const response = await GET(new NextRequest("http://localhost/api/reports/hashavshevet/client-export"));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "נדרש sessionId" });
      expect(load).not.toHaveBeenCalled();
    });

    it("answers 404 when the reconciliation session does not exist", async () => {
      givenData({ session: null, client: null });
      const response = await GET(request({}));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "התאמה לא נמצאה" });
    });

    it("answers 404 when the session's client does not exist", async () => {
      givenData({ client: null, comparisons: [comp("ויני חדרה", "1000")] });
      const response = await GET(request({}));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "לקוח לא נמצא" });
    });

    it("answers 400 when there are no approved comparisons", async () => {
      givenData({ comparisons: [] });
      const response = await GET(request({}));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "אין שורות מאושרות לייצוא" });
    });

    it("answers 400 when every amount is zero or empty", async () => {
      givenData({ comparisons: [comp("ויני חדרה", "0"), comp("ויני כרמיאל", "0.00"), comp("מינה שרונה", null)] });
      const response = await GET(request({}));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "אין סכומים לייצוא (כל הסכומים אפס)" });
    });

    it("answers 500 with a generic Hebrew message when the load fails", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      load.mockRejectedValue(new Error("connection reset"));
      const response = await GET(request({}));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "שגיאה ביצירת קובץ חשבשבת" });
      spy.mockRestore();
    });
  });

  describe("query", () => {
    it("loads the session as an invoice by default, and as a journal only for exportType=journal", async () => {
      givenData({ comparisons: [comp("ויני חדרה", "1000")] });
      await GET(request({}));
      expect(load).toHaveBeenLastCalledWith({ sessionId: "sess-1", docKind: "invoice" });
      await GET(request({ exportType: "journal" }));
      expect(load).toHaveBeenLastCalledWith({ sessionId: "sess-1", docKind: "journal" });
      await GET(request({ exportType: "anything-else" }));
      expect(load).toHaveBeenLastCalledWith({ sessionId: "sess-1", docKind: "invoice" });
    });
  });

  describe("rows", () => {
    it("writes one row per non-zero comparison: item key, quantity 1, empty name and number, type 11", async () => {
      givenData({
        comparisons: [
          comp("ויני חדרה", "1234.4"),
          comp("ויני כרמיאל", "0"), // skipped
          comp("מינה שרונה", null), // skipped
          comp("קינג עפולה", "-100.4"), // credit keeps its sign
          comp("דון פדרו", "1234.5"),
        ],
      });
      expect(await exportRows()).toEqual([
        HEADER,
        ["70001", "", "עמלות ויני חדרה", "", 1, 1234, 11, ""],
        ["70001", "", "עמלות קינג עפולה", "", 1, -100, 11, ""],
        ["70001", "", "עמלות דון פדרו", "", 1, 1235, 11, ""],
      ]);
    });

    it("keeps a row whose rounded price is 0 (the zero test runs before rounding)", async () => {
      givenData({ comparisons: [comp("ויני חדרה", "0.4"), comp("מינה שרונה", "500")] });
      expect(await exportRows()).toEqual([
        HEADER,
        ["70001", "", "עמלות ויני חדרה", "", 1, 0, 11, ""],
        ["70001", "", "עמלות מינה שרונה", "", 1, 500, 11, ""],
      ]);
    });

    it("writes document type 1 for a journal export, with the full amount", async () => {
      givenData({ comparisons: [comp("ויני חדרה", "1000.6")] });
      expect(await exportRows({ exportType: "journal" })).toEqual([
        HEADER,
        ["70001", "", "עמלות ויני חדרה", "", 1, 1001, 1, ""],
      ]);
    });

    it("resolves the account per row: brand override, then code, then name", async () => {
      givenData({
        client: account({ hashavshevetCode: "70001", hashavshevetByBrand: { "b-vini": "ויני גיפט", "b-mina": "  " } }),
        comparisons: [
          comp("ויני חדרה", "100", { franchiseeBrandId: "b-vini" }),
          comp("מינה שרונה", "200", { franchiseeBrandId: "b-mina" }), // blank override falls through
          comp("דון פדרו", "300", { franchiseeBrandId: "b-misc" }),
          comp("אורח", "400", { franchiseeBrandId: null }),
        ],
      });
      const rows = await exportRows();
      expect(rows.slice(1).map((r) => r[0])).toEqual(["ויני גיפט", "70001", "70001", "70001"]);

      givenData({
        client: account({ hashavshevetName: "גולדה בע״מ" }),
        comparisons: [comp("ויני חדרה", "100")],
      });
      expect((await exportRows())[1][0]).toBe("גולדה בע״מ");

      givenData({ client: account({}), comparisons: [comp("ויני חדרה", "100")] });
      expect((await exportRows())[1][0]).toBe("גולדה");
    });
  });

  describe("LA TABLE half-price rule", () => {
    const comparisons = [comp("ויני חדרה", "1001"), comp("מינה שרונה", "3"), comp("קינג עפולה", "1000.4"), comp("דון פדרו", "-3")];

    it.each(["LATABLE", "LATABLEMARK"])("halves and rounds the invoice amount for %s", async (code) => {
      givenData({ client: account({ code, hashavshevetCode: "70002" }), comparisons });
      const rows = await exportRows({ exportType: "invoice" });
      // 500.5 -> 501, 1.5 -> 2, 500.2 -> 500, -1.5 -> -1 (Math.round rounds half up)
      expect(rows.slice(1).map((r) => [r[5], r[6]])).toEqual([[501, 11], [2, 11], [500, 11], [-1, 11]]);
    });

    it.each(["LATABLE", "LATABLEMARK"])("keeps the full amount in a journal export for %s", async (code) => {
      givenData({ client: account({ code, hashavshevetCode: "70002" }), comparisons });
      const rows = await exportRows({ exportType: "journal" });
      expect(rows.slice(1).map((r) => [r[5], r[6]])).toEqual([[1001, 1], [3, 1], [1000, 1], [-3, 1]]);
    });

    it("does not halve for another client", async () => {
      givenData({ client: account({ code: "LATABLEX", hashavshevetCode: "70002" }), comparisons });
      const rows = await exportRows({ exportType: "invoice" });
      expect(rows.slice(1).map((r) => r[5])).toEqual([1001, 3, 1000, -3]);
    });

    it("skips a zero net, and rounds half of a net of 1 up to 1", async () => {
      givenData({ client: account({ code: "LATABLE", hashavshevetCode: "70002" }), comparisons: [comp("ויני חדרה", "0"), comp("מינה שרונה", "1")] });
      const rows = await exportRows();
      expect(rows.slice(1).map((r) => r[5])).toEqual([1]); // round(0.5) = 1
    });
  });

  describe("workbook and response", () => {
    it("sends an xlsx with the named range, column widths and numeric formats", async () => {
      givenData({ comparisons: [comp("ויני חדרה", "12345"), comp("מינה שרונה", "500")] });
      const response = await GET(request({}));
      expect(response.headers.get("Content-Type")).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      const wb = XLSX.read(Buffer.from(await response.arrayBuffer()), { cellNF: true, cellStyles: true });
      expect(wb.Workbook?.Names?.find((n) => n.Name === "חוזים")?.Ref).toBe("'ייבוא חשבשבת'!$A$1:$H$3");
      const ws = wb.Sheets[SHEET];
      expect(ws["!cols"]?.map((c) => c.wch)).toEqual([15, 10, 35, 10, 8, 12, 12, 12]);
      expect([ws.E2.t, ws.E2.z]).toEqual(["n", "0"]);
      expect([ws.F2.t, ws.F2.z, ws.F2.v]).toEqual(["n", "#,##0.00", 12345]);
      expect([ws.G2.t, ws.G2.z]).toEqual(["n", "0"]);
      expect(ws.A2.t).toBe("s");
    });

    it("names the file after the document kind, client and period", async () => {
      givenData({ comparisons: [comp("ויני חדרה", "1000")] });
      expect(filenameOf(await GET(request({})))).toBe("חשבוניות גולדה ספטמבר 2026.xlsx");
      expect(filenameOf(await GET(request({ exportType: "journal" })))).toBe("פקודת יומן גולדה ספטמבר 2026.xlsx");
    });

    it("falls back to the month number when it is out of range", async () => {
      givenData({ session: { ...SESSION, periodMonth: 13 }, comparisons: [comp("ויני חדרה", "1000")] });
      expect(filenameOf(await GET(request({})))).toBe("חשבוניות גולדה 13 2026.xlsx");
    });
  });
});
