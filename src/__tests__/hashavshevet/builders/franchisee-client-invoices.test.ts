import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExportRow } from "@/data-access/client-reconciliation-approval";
import type { OccasionalClientExportRow } from "@/data-access/occasional-clients";
import {
  buildFranchiseeClientInvoicesRows,
  franchiseeClientInvoicesExport,
  type FranchiseeClientInvoicesData,
} from "@/lib/hashavshevet/builders/franchisee-client-invoices";
import { EXPORTS } from "@/lib/hashavshevet/registry";

// The three reads behind the loader are mocked; nothing reaches a real database.
const mocks = vi.hoisted(() => ({
  approved: vi.fn(),
  occasional: vi.fn(),
  franchiseeRows: [] as unknown[],
}));
vi.mock("@/data-access/client-reconciliation-approval", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data-access/client-reconciliation-approval")>()),
  getApprovedForExport: mocks.approved,
}));
vi.mock("@/data-access/occasional-clients", () => ({ getOccasionalClientsForExport: mocks.occasional }));
vi.mock("@/db", () => {
  const chain: Record<string, unknown> = {};
  for (const step of ["from", "where", "limit"]) chain[step] = () => chain;
  chain.then = (resolve: (rows: unknown[]) => void) => resolve(mocks.franchiseeRows);
  return { database: { select: () => chain } };
});

const COLUMNS = [
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

const FRANCHISEE = { name: "ויני חדרה", hashavshevetRevenueAccount: null, hashavshevetCompanyId: "company-vini" };

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

function data(over: Partial<FranchiseeClientInvoicesData> = {}): FranchiseeClientInvoicesData {
  return {
    franchiseeId: "fr-1",
    periodMonth: 9,
    periodYear: 2026,
    franchisee: FRANCHISEE,
    approved: [approved("CIBUS", 1234.5)],
    occasional: [],
    ...over,
  } as FranchiseeClientInvoicesData;
}

describe("buildFranchiseeClientInvoicesRows", () => {
  it("keys a row by client|franchisee|YYYY-MM|itemKey, with the franchisee's company", () => {
    const { rows, blockingErrors } = buildFranchiseeClientInvoicesRows(data());

    expect(blockingErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.rowKey).toBe("c-CIBUS|fr-1|2026-09|ארוחות");
    expect(row.documentKey).toBe(row.rowKey);
    expect(row.companyId).toBe("company-vini");
    expect(row.amount).toBe(1235);
    expect(row.periodEnd).toBe("2026-09-30");
    expect(Object.keys(row.display)).toEqual(COLUMNS);
    expect(Object.values(row.display)).toEqual(["חשבון CIBUS", "", "ארוחות", "", 1, 1235, 15.2543, 11, 1]);
  });

  it("leaves companyId null when the franchisee has no Hashavshevet company", () => {
    const [row] = buildFranchiseeClientInvoicesRows(
      data({ franchisee: { ...FRANCHISEE, hashavshevetCompanyId: null } } as Partial<FranchiseeClientInvoicesData>),
    ).rows;
    expect(row.companyId).toBeNull();
  });

  it("pads a single-digit month in the key, and takes the month's real last day for periodEnd", () => {
    const march = buildFranchiseeClientInvoicesRows(data({ periodMonth: 3, periodYear: 2027 })).rows[0];
    expect(march.rowKey).toBe("c-CIBUS|fr-1|2027-03|ארוחות");
    expect(march.periodEnd).toBe("2027-03-31");
    const leap = buildFranchiseeClientInvoicesRows(data({ periodMonth: 2, periodYear: 2028 })).rows[0];
    expect(leap.periodEnd).toBe("2028-02-29");
    const feb = buildFranchiseeClientInvoicesRows(data({ periodMonth: 2, periodYear: 2026 })).rows[0];
    expect(feb.rowKey).toBe("c-CIBUS|fr-1|2026-02|ארוחות");
    expect(feb.periodEnd).toBe("2026-02-28");
    const dec = buildFranchiseeClientInvoicesRows(data({ periodMonth: 12 })).rows[0];
    expect(dec.periodEnd).toBe("2026-12-31");
  });

  it("builds the imovein apiRow as exact strings, the discount with its four decimals", () => {
    const { rows } = buildFranchiseeClientInvoicesRows(
      data({ approved: [approved("CIBUS", 1234.5), approved("GIFTCARD", 300)] }),
    );
    expect(rows[0].apiRow).toEqual({
      accountKey: "חשבון CIBUS",
      itemkey: "ארוחות",
      Quantity: "1.000",
      price: "1235.00",
      Discountprc: "15.2543",
      DocumentID: "1",
      Reference: "1",
    });
    expect(rows[1].apiRow).toEqual({
      accountKey: "חשבון GIFTCARD",
      itemkey: "גיפט",
      Quantity: "1.000",
      price: "300.00",
      Discountprc: "19.2543", // R21: never rounded to 2 decimals
      DocumentID: "1",
      Reference: "2",
    });
    expect(rows[0].apiRow).not.toHaveProperty("valueDate");
  });

  it("sends the Excel document number as the Reference, 1..N over approved then occasional rows", () => {
    const { rows } = buildFranchiseeClientInvoicesRows(
      data({ approved: [approved("A", 10), approved("B", 0), approved("C", 30)], occasional: [occasional("ז", 5)] }),
    );
    expect(rows.map((r) => [r.display["מספר מסמך"], r.apiRow.Reference])).toEqual([
      [1, "1"],
      [2, "2"],
      [3, "3"],
    ]);
    expect(rows.map((r) => r.rowKey)).toEqual([
      "c-A|fr-1|2026-09|ארוחות",
      "c-C|fr-1|2026-09|ארוחות",
      "o-ז|fr-1|2026-09|ארוחות",
    ]);
  });

  it("carries the resolved item key into the rowKey and the apiRow (GIFTCARD, client key, franchisee account)", () => {
    const franchisee = { ...FRANCHISEE, hashavshevetRevenueAccount: " הכנסותנ " };
    const { rows } = buildFranchiseeClientInvoicesRows(
      data({
        franchisee,
        approved: [
          approved("GIFTCARD", 300, { clientItemKey: "ארוחותש" }),
          approved("LATABLEMARK", 1000, { clientItemKey: "ארוחותש" }),
          approved("TENBIS", 500),
        ],
        occasional: [occasional("א", 40)],
      } as Partial<FranchiseeClientInvoicesData>),
    );
    expect(rows.map((r) => [r.rowKey, r.apiRow.itemkey, r.apiRow.Discountprc])).toEqual([
      ["c-GIFTCARD|fr-1|2026-09|גיפט", "גיפט", "19.2543"],
      ["c-LATABLEMARK|fr-1|2026-09|ארוחותש", "ארוחותש", "15.2543"],
      ["c-TENBIS|fr-1|2026-09|הכנסותנ", "הכנסותנ", "15.2543"],
      ["o-א|fr-1|2026-09|הכנסותנ", "הכנסותנ", "15.2543"],
    ]);
  });

  it("prices like the Excel: WOLT exact, La Table halved, others rounded, zero dropped", () => {
    const { rows } = buildFranchiseeClientInvoicesRows(
      data({
        approved: [
          approved("WOLT", 999, { netAmount: 1234.56 }),
          approved("LATABLE", 1001),
          approved("TENBIS", -100.4),
          approved("HEVER", 0.4),
        ],
      }),
    );
    expect(rows.map((r) => [r.amount, r.display["מחיר"], r.apiRow.price])).toEqual([
      [1234.56, 1234.56, "1234.56"],
      [501, 501, "501.00"],
      [-100, -100, "-100.00"],
    ]);
  });

  it("includes the TENBIS client before July 2026 only, unless it is flagged", () => {
    const unflagged = approved("TENBIS", 800, { invoiceGeneration: false });
    expect(buildFranchiseeClientInvoicesRows(data({ approved: [unflagged], periodMonth: 6 })).rows).toHaveLength(1);
    expect(buildFranchiseeClientInvoicesRows(data({ approved: [unflagged], periodMonth: 7 })).blockingErrors).toEqual([
      "אין לקוחות עם הפקת חשבונית מסומנת בתקופה זו",
    ]);
  });

  describe("when there is nothing to build", () => {
    it.each([
      ["no franchisee", { franchisee: null, approved: [] }, "זכיין לא נמצא"],
      [
        "no client flagged for invoices",
        { approved: [approved("WOLT", 100, { invoiceGeneration: false })] },
        "אין לקוחות עם הפקת חשבונית מסומנת בתקופה זו",
      ],
      ["only zero amounts", { approved: [approved("CIBUS", 0)], occasional: [occasional("א", 0.2)] }, "אין סכומים לייצוא (כל הסכומים אפס)"],
    ])("reports %s as a blocking error with the Excel route's text", (_name, over, message) => {
      expect(buildFranchiseeClientInvoicesRows(data(over as Partial<FranchiseeClientInvoicesData>))).toEqual({
        rows: [],
        blockingErrors: [message],
      });
    });
  });
});

describe("franchiseeClientInvoicesExport", () => {
  beforeEach(() => {
    mocks.approved.mockReset();
    mocks.occasional.mockReset();
    mocks.franchiseeRows = [FRANCHISEE];
  });

  it("is registered as the imovein franchisee client invoices export", () => {
    expect(EXPORTS.franchisee_client_invoices).toBe(franchiseeClientInvoicesExport);
    expect(franchiseeClientInvoicesExport.type).toBe("franchisee_client_invoices");
    expect(franchiseeClientInvoicesExport.plugin).toBe("imovein");
  });

  it("parses the params, loads and builds", async () => {
    mocks.approved.mockResolvedValue([approved("CIBUS", 1000)]);
    mocks.occasional.mockResolvedValue([occasional("א", 50)]);

    const result = await franchiseeClientInvoicesExport.build({ franchiseeId: "fr-1", periodMonth: 9, periodYear: 2026 });

    expect(mocks.approved).toHaveBeenCalledWith({ franchiseeId: "fr-1", periodMonth: 9, periodYear: 2026 });
    expect(mocks.occasional).toHaveBeenCalledWith({ franchiseeId: "fr-1", periodMonth: 9, periodYear: 2026 });
    expect(result.blockingErrors).toEqual([]);
    expect(result.rows.map((r) => [r.rowKey, r.companyId])).toEqual([
      ["c-CIBUS|fr-1|2026-09|ארוחות", "company-vini"],
      ["o-א|fr-1|2026-09|ארוחות", "company-vini"],
    ]);
  });

  it("reports a missing franchisee as a blocking error without reading the period", async () => {
    mocks.franchiseeRows = [];
    const result = await franchiseeClientInvoicesExport.build({ franchiseeId: "nope", periodMonth: 9, periodYear: 2026 });
    expect(result).toEqual({ rows: [], blockingErrors: ["זכיין לא נמצא"] });
    expect(mocks.approved).not.toHaveBeenCalled();
    expect(mocks.occasional).not.toHaveBeenCalled();
  });

  it("rejects params that fail the schema before reading anything", async () => {
    await expect(franchiseeClientInvoicesExport.build({ franchiseeId: "", periodMonth: 9, periodYear: 2026 })).rejects.toThrow();
    await expect(franchiseeClientInvoicesExport.build({ franchiseeId: "f", periodMonth: 13, periodYear: 2026 })).rejects.toThrow();
    expect(mocks.approved).not.toHaveBeenCalled();
  });
});
