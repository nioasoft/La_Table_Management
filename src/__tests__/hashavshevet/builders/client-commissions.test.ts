import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildClientCommissionsRows,
  clientCommissionsExport,
  type ClientCommissionsClient,
  type ClientCommissionsComparison,
  type ClientCommissionsData,
} from "@/lib/hashavshevet/builders/client-commissions";
import { copy } from "@/lib/hashavshevet/copy";
import { EXPORTS } from "@/lib/hashavshevet/registry";

// The two reads behind the loader are mocked; nothing reaches a real database.
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  approved: vi.fn(),
  clientRows: [] as unknown[],
}));
vi.mock("@/data-access/client-reconciliation", () => ({
  getSessionWithComparisons: mocks.session,
  getApprovedComparisonsForExport: mocks.approved,
}));
vi.mock("@/db", () => {
  const chain: Record<string, unknown> = {};
  for (const step of ["from", "where", "limit"]) chain[step] = () => chain;
  chain.then = (resolve: (rows: unknown[]) => void) => resolve(mocks.clientRows);
  return { database: { select: () => chain } };
});

const SESSION = { clientId: "c-1", clientName: "גולדה", periodMonth: 9, periodYear: 2026 };
const CLIENT: ClientCommissionsClient = {
  code: "GOLDA",
  name: "גולדה",
  hashavshevetCode: "70001",
  hashavshevetName: null,
  hashavshevetByBrand: null,
};

function comp(name: string, netAmount: string | null, over: Partial<ClientCommissionsComparison> = {}): ClientCommissionsComparison {
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

function data(over: Partial<ClientCommissionsData> = {}): ClientCommissionsData {
  return {
    sessionId: "sess-1",
    docKind: "invoice",
    session: SESSION,
    client: CLIENT,
    comparisons: [comp("ויני חדרה", "1234.5", { hashavshevetCompanyId: "company-panikon" })],
    ...over,
  };
}

const COLUMNS = ["מפתח חשבון", "שם", "מפתח פריט", "שם פריט", "כמות", "מחיר", "סוג המסמך", "מספר מסמך"];

describe("buildClientCommissionsRows", () => {
  it("keys an invoice row by client|franchisee|periodStart|periodEnd|docKind, with the franchisee's company", () => {
    const { rows, blockingErrors } = buildClientCommissionsRows(data());

    expect(blockingErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.rowKey).toBe("c-1|f-ויני חדרה|2026-09-01|2026-09-30|invoice");
    expect(row.documentKey).toBe(row.rowKey);
    expect(row.companyId).toBe("company-panikon");
    expect(row.periodEnd).toBe("2026-09-30");
    expect(row.amount).toBe(1235);
    expect(Object.keys(row.display)).toEqual(COLUMNS);
    expect(Object.values(row.display)).toEqual(["70001", "", "עמלות ויני חדרה", "", 1, 1235, 11, ""]);
  });

  it("leaves companyId null when the franchisee has no Hashavshevet company", () => {
    const [row] = buildClientCommissionsRows(data({ comparisons: [comp("מינה שרונה", "500")] })).rows;
    expect(row.companyId).toBeNull();
  });

  it("takes the period from the session month, using the month's real last day", () => {
    const feb = buildClientCommissionsRows(data({ session: { ...SESSION, periodMonth: 2, periodYear: 2028 } })).rows[0];
    expect(feb.rowKey).toBe("c-1|f-ויני חדרה|2028-02-01|2028-02-29|invoice");
    expect(feb.periodEnd).toBe("2028-02-29");
    const dec = buildClientCommissionsRows(data({ session: { ...SESSION, periodMonth: 12 } })).rows[0];
    expect(dec.rowKey).toBe("c-1|f-ויני חדרה|2026-12-01|2026-12-31|invoice");
  });

  it("builds the imovein apiRow as exact strings, without Reference or valueDate", () => {
    const [row] = buildClientCommissionsRows(data()).rows;
    expect(row.apiRow).toEqual({
      accountKey: "70001",
      itemkey: "עמלות ויני חדרה",
      Quantity: "1.000",
      price: "1235.00",
      DocumentID: "1",
    });
    expect(row.apiRow).not.toHaveProperty("Reference");
    expect(row.apiRow).not.toHaveProperty("valueDate");
  });

  it("skips zero and empty nets and keeps the loader's order", () => {
    const { rows } = buildClientCommissionsRows(
      data({ comparisons: [comp("א", "100"), comp("ב", "0"), comp("ג", null), comp("ד", "-40.4")] }),
    );
    expect(rows.map((r) => [r.rowKey.split("|")[1], r.amount])).toEqual([["f-א", 100], ["f-ד", -40]]);
    expect(rows[1].apiRow.price).toBe("-40.00");
  });

  it("resolves the account key per franchisee brand", () => {
    const client = { ...CLIENT, hashavshevetByBrand: { "b-vini": "ויני גיפט" } };
    const { rows } = buildClientCommissionsRows(
      data({ client, comparisons: [comp("ויני חדרה", "100"), comp("מינה שרונה", "200", { franchiseeBrandId: "b-mina" })] }),
    );
    expect(rows.map((r) => [r.display["מפתח חשבון"], r.apiRow.accountKey])).toEqual([
      ["ויני גיפט", "ויני גיפט"],
      ["70001", "70001"],
    ]);
  });

  describe("LA TABLE half-price rule", () => {
    const comparisons = [comp("ויני חדרה", "1001"), comp("מינה שרונה", "3")];

    it.each(["LATABLE", "LATABLEMARK"])("halves the invoice amount for %s in amount, price and apiRow", (code) => {
      const { rows } = buildClientCommissionsRows(data({ client: { ...CLIENT, code }, comparisons }));
      expect(rows.map((r) => r.amount)).toEqual([501, 2]); // 500.5 -> 501, 1.5 -> 2
      expect(rows.map((r) => r.display["מחיר"])).toEqual([501, 2]);
      expect(rows.map((r) => r.apiRow.price)).toEqual(["501.00", "2.00"]);
    });

    it("does not halve a journal export", () => {
      const { rows } = buildClientCommissionsRows(
        data({ docKind: "journal", client: { ...CLIENT, code: "LATABLE" }, comparisons }),
      );
      expect(rows.map((r) => r.amount)).toEqual([1001, 3]);
    });

    it("does not halve another client", () => {
      const { rows } = buildClientCommissionsRows(data({ client: { ...CLIENT, code: "GOLDA" }, comparisons }));
      expect(rows.map((r) => r.amount)).toEqual([1001, 3]);
    });
  });

  describe("journal export (Excel type 1)", () => {
    it("blocks the API path with the unsupported-journal message, but still builds every display row", () => {
      const { rows, blockingErrors } = buildClientCommissionsRows(
        data({ docKind: "journal", comparisons: [comp("ויני חדרה", "1000.6"), comp("מינה שרונה", "200")] }),
      );

      expect(blockingErrors).toEqual([copy.unsupportedJournalDocType]);
      expect(rows).toHaveLength(2);
      expect(rows[0].rowKey).toBe("c-1|f-ויני חדרה|2026-09-01|2026-09-30|journal");
      expect(Object.values(rows[0].display)).toEqual(["70001", "", "עמלות ויני חדרה", "", 1, 1001, 1, ""]);
      expect(rows[0].amount).toBe(1001);
    });

    it("produces no API row for it, instead of throwing", () => {
      const { rows } = buildClientCommissionsRows(data({ docKind: "journal" }));
      expect(rows[0].apiRow).toEqual({});
    });
  });

  describe("when there is nothing to build", () => {
    it.each([
      ["no reconciliation session", { session: null, client: null, comparisons: [] }, "התאמה לא נמצאה"],
      ["no client", { client: null }, "לקוח לא נמצא"],
      ["no approved rows", { comparisons: [] }, "אין שורות מאושרות לייצוא"],
      ["only zero amounts", { comparisons: [comp("א", "0"), comp("ב", null)] }, "אין סכומים לייצוא (כל הסכומים אפס)"],
    ])("reports %s as a blocking error with the Excel route's text", (_name, over, message) => {
      expect(buildClientCommissionsRows(data(over))).toEqual({ rows: [], blockingErrors: [message] });
    });

    it("reports that, not the journal message, for an empty journal export", () => {
      expect(buildClientCommissionsRows(data({ docKind: "journal", comparisons: [] })).blockingErrors).toEqual([
        "אין שורות מאושרות לייצוא",
      ]);
    });
  });
});

describe("clientCommissionsExport", () => {
  beforeEach(() => {
    mocks.session.mockReset();
    mocks.approved.mockReset();
    mocks.clientRows = [CLIENT];
  });

  it("is registered as the imovein client commissions export", () => {
    expect(EXPORTS.client_commissions).toBe(clientCommissionsExport);
    expect(clientCommissionsExport.type).toBe("client_commissions");
    expect(clientCommissionsExport.plugin).toBe("imovein");
  });

  it("parses the params (docKind defaults to invoice), loads and builds", async () => {
    mocks.session.mockResolvedValue({ session: SESSION, comparisons: [] });
    mocks.approved.mockResolvedValue([comp("ויני חדרה", "1000", { hashavshevetCompanyId: "company-panikon" })]);

    const result = await clientCommissionsExport.build({ sessionId: "sess-1" });

    expect(mocks.session).toHaveBeenCalledWith("sess-1");
    expect(mocks.approved).toHaveBeenCalledWith("sess-1");
    expect(result.blockingErrors).toEqual([]);
    expect(result.rows.map((r) => [r.rowKey, r.companyId])).toEqual([
      ["c-1|f-ויני חדרה|2026-09-01|2026-09-30|invoice", "company-panikon"],
    ]);
  });

  it("builds a journal session with display rows and the blocking error", async () => {
    mocks.session.mockResolvedValue({ session: SESSION, comparisons: [] });
    mocks.approved.mockResolvedValue([comp("ויני חדרה", "1000")]);

    const result = await clientCommissionsExport.build({ sessionId: "sess-1", docKind: "journal" });

    expect(result.blockingErrors).toEqual([copy.unsupportedJournalDocType]);
    expect(result.rows).toHaveLength(1);
  });

  it("rejects params that fail the schema before reading anything", async () => {
    await expect(clientCommissionsExport.build({ sessionId: "" })).rejects.toThrow();
    await expect(clientCommissionsExport.build({ sessionId: "s", docKind: "credit" })).rejects.toThrow();
    expect(mocks.session).not.toHaveBeenCalled();
  });
});
