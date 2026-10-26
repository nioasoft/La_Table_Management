import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExportRow } from "@/data-access/client-reconciliation-approval";
import {
  buildJournalEntriesRows,
  journalEntriesExport,
  type JournalEntriesData,
} from "@/lib/hashavshevet/builders/journal-entries";
import { internalReference } from "@/lib/hashavshevet/format";
import { EXPORTS } from "@/lib/hashavshevet/registry";

// The two reads behind the loader are mocked; nothing reaches a real database.
const mocks = vi.hoisted(() => ({ approved: vi.fn(), franchiseeRows: [] as unknown[] }));
vi.mock("@/data-access/client-reconciliation-approval", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data-access/client-reconciliation-approval")>()),
  getApprovedForExport: mocks.approved,
}));
vi.mock("@/db", () => {
  const chain: Record<string, unknown> = {};
  for (const step of ["from", "where", "limit"]) chain[step] = () => chain;
  chain.then = (resolve: (rows: unknown[]) => void) => resolve(mocks.franchiseeRows);
  return { database: { select: () => chain } };
});

const COLUMNS = [
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

const FRANCHISEE = { name: "ויני חדרה", hashavshevetRevenueAccount: null, hashavshevetCompanyId: "company-vini" };

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

function data(over: Partial<JournalEntriesData> = {}): JournalEntriesData {
  return {
    franchiseeId: "fr-1",
    periodMonth: 9,
    periodYear: 2026,
    franchisee: FRANCHISEE,
    approved: [approved("MISHLOCHA", 1180)],
    ...over,
  } as JournalEntriesData;
}

const rowsOf = (over: Partial<JournalEntriesData> = {}) => buildJournalEntriesRows(data(over)).rows;
const cents = (money: string) => Math.round(Number(money) * 100);

describe("buildJournalEntriesRows", () => {
  it("keys a regular row by clientId|franchisee|YYYY-MM|regular, with the franchisee's company", () => {
    const { rows, blockingErrors } = buildJournalEntriesRows(data());
    expect(blockingErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.rowKey).toBe("c-MISHLOCHA|fr-1|2026-09|regular");
    expect(row.documentKey).toBe(row.rowKey);
    expect(row.companyId).toBe("company-vini");
    expect(row.amount).toBe(1180);
    expect(row.periodEnd).toBe("2026-09-30");
    expect(row).not.toHaveProperty("vatSplit");
  });

  it("leaves companyId null when the franchisee has no Hashavshevet company", () => {
    const [row] = rowsOf({ franchisee: { ...FRANCHISEE, hashavshevetCompanyId: null } });
    expect(row.companyId).toBeNull();
  });

  it("keys HEVER's two lines apart, pads the month and dates the month's real last day", () => {
    const rows = rowsOf({ approved: [approved("HEVER", 500)], periodMonth: 2, periodYear: 2028 });
    expect(rows.map((r) => [r.rowKey, r.periodEnd])).toEqual([
      ["c-HEVER|fr-1|2028-02|hever_commission", "2028-02-29"],
      ["c-HEVER|fr-1|2028-02|hever_contra", "2028-02-29"],
    ]);
    expect(new Set(rows.map((r) => r.documentKey)).size).toBe(2);
  });

  it("shows the Excel's eleven columns: dates as text, G exact, H and I as the Excel's computed values", () => {
    const [row] = rowsOf({
      approved: [approved("WOLT", 1000, { netAmount: 900.55, invoiceNumber: "W-778899", allocationNumber: "012345678" })],
    });
    expect(Object.keys(row.display)).toEqual(COLUMNS);
    const vat = (900.55 * 0.18) / 1.18;
    expect(Object.values(row.display)).toEqual([
      "8899", "30/09/2026", "30/09/2026", "חן WOLT", "הכנסות", "מעמעס", 900.55, 900.55 - vat, vat, "ארוחות", "012345678",
    ]);
  });

  it("builds a regular VAT-split movein row as exact strings that balance", () => {
    const [row] = rowsOf({
      franchisee: { ...FRANCHISEE, hashavshevetRevenueAccount: "הכנסותנ" },
      approved: [approved("HAAT", 1234.57, { invoiceNumber: "SI-000123456" })],
    });
    expect(row.apiRow).toEqual({
      TransType: "00",
      Reference: internalReference("LT", "c-HAAT|fr-1|2026-09|regular"),
      Ref2: "3456",
      ValueDate: "30/09/2026",
      DueDate: "30/09/2026",
      AccountKeyDeb1: "חן HAAT",
      SuFDeb1: "1234.57",
      AccountKeyCred1: "הכנסותנ",
      SuFCred1: "1046.25",
      AccountKeyCred2: "מעמעס",
      SuFCred2: "188.32",
      Details: "ארוחות",
    });
  });

  it("books Wolt's net amount, with its allocation number as the exact string", () => {
    const [row] = rowsOf({
      approved: [approved("WOLT", 1000, { netAmount: 900.55, invoiceNumber: "W-778899", allocationNumber: "012345678" })],
    });
    expect(row.amount).toBe(900.55);
    expect(row.apiRow).toMatchObject({ Ref2: "8899", SuFDeb1: "900.55", SuFCred1: "763.18", SuFCred2: "137.37" });
    expect(row.apiRow.TaxAPINumber).toBe("012345678");
  });

  it("builds both HEVER lines: a negative commission split and a gross contra without VAT", () => {
    const [commission, contra] = rowsOf({
      approved: [approved("HEVER", 1234.57, { allocationNumber: "012345678" })],
    });
    expect(commission.amount).toBe(-222.22);
    expect(commission.display["סכום חובה"]).toBe(-(1234.57 * 0.18));
    expect(commission.apiRow).toEqual({
      TransType: "00",
      Reference: internalReference("LT", "c-HEVER|fr-1|2026-09|hever_commission"),
      Ref2: "9999",
      ValueDate: "30/09/2026",
      DueDate: "30/09/2026",
      AccountKeyDeb1: "חן HEVER",
      SuFDeb1: "-222.22",
      AccountKeyCred1: "הכנ עמלות חבר",
      SuFCred1: "-188.32",
      AccountKeyCred2: "מעמעס",
      SuFCred2: "-33.90",
      Details: "עמלה",
      TaxAPINumber: "012345678",
    });
    expect(contra.amount).toBe(1234.57);
    expect(contra.apiRow).toEqual({
      TransType: "00",
      Reference: internalReference("LT", "c-HEVER|fr-1|2026-09|hever_contra"),
      Ref2: "9999",
      ValueDate: "30/09/2026",
      DueDate: "30/09/2026",
      AccountKeyDeb1: "חן HEVER",
      SuFDeb1: "1234.57",
      AccountKeyCred1: "אמריקן",
      SuFCred1: "1234.57",
      Details: "מיון",
    });
    expect(commission.apiRow.Reference).not.toBe(contra.apiRow.Reference);
  });

  it("omits empty fields instead of sending empty strings", () => {
    const [row] = rowsOf({ approved: [approved("CIBUS", 100, { invoiceNumber: "123456", allocationNumber: null })] });
    expect(row.apiRow).not.toHaveProperty("Ref2");
    expect(row.apiRow).not.toHaveProperty("TaxAPINumber");
    expect(Object.values(row.apiRow)).not.toContain("");
    expect(Object.values(row.apiRow).every((v) => typeof v === "string")).toBe(true);
  });

  it("balances every VAT-split line to the agora: SuFCred1 + SuFCred2 === SuFDeb1", () => {
    const awkward = [0.01, 0.05, 0.99, 1, 1.17, 1.18, 99.99, 1234.57, -218.18, -0.03, 4999.995, 100000, 77777.77];
    const amounts = [...awkward];
    for (let c = 1; c <= 10_000_000; c += 997) amounts.push(c / 100);
    const rows = rowsOf({
      approved: amounts.flatMap((amount, n) => [
        approved("MISHLOCHA", amount, { clientId: `m-${n}` }),
        approved("HEVER", amount, { clientId: `h-${n}` }),
      ]),
    });
    const split = rows.filter((r) => !r.rowKey.endsWith("|hever_contra"));
    expect(split).toHaveLength(amounts.length * 2);
    for (const { apiRow } of split) {
      expect(cents(apiRow.SuFCred1) + cents(apiRow.SuFCred2), JSON.stringify(apiRow)).toBe(cents(apiRow.SuFDeb1));
      expect(apiRow.SuFDeb1).toMatch(/^-?\d+\.\d{2}$/);
    }
    for (const { apiRow } of rows.filter((r) => r.rowKey.endsWith("|hever_contra"))) {
      expect(apiRow.SuFCred1).toBe(apiRow.SuFDeb1);
      expect(apiRow).not.toHaveProperty("SuFCred2");
    }
  });

  it("drops zero amounts and books only flagged clients, TENBIS from July 2026", () => {
    const rows = rowsOf({
      approved: [
        approved("TENBIS", 800),
        approved("CIBUS", 100, { journalEntryGeneration: false }),
        approved("MISHLOCHA", 0),
        approved("WOLT", 50),
      ],
      periodMonth: 6,
    });
    expect(rows.map((r) => r.rowKey)).toEqual(["c-WOLT|fr-1|2026-06|regular"]);
    expect(rowsOf({ approved: [approved("TENBIS", 800)], periodMonth: 7 }).map((r) => r.rowKey)).toEqual([
      "c-TENBIS|fr-1|2026-07|regular",
    ]);
  });

  describe("when there is nothing to build", () => {
    it.each([
      ["no franchisee", { franchisee: null, approved: [] }, "זכיין לא נמצא"],
      [
        "no client flagged for journal entries",
        { approved: [approved("CIBUS", 100, { journalEntryGeneration: false })] },
        "אין לקוחות עם הפקת פקודת יומן מסומנת בתקופה זו",
      ],
      ["only zero amounts", { approved: [approved("WOLT", 100, { netAmount: 0 }), approved("HEVER", 0)] }, "אין סכומים לייצוא (כל הסכומים אפס)"],
    ])("reports %s as a blocking error with the Excel route's text", (_name, over, message) => {
      expect(buildJournalEntriesRows(data(over as Partial<JournalEntriesData>))).toEqual({ rows: [], blockingErrors: [message] });
    });
  });
});

describe("journalEntriesExport", () => {
  beforeEach(() => {
    mocks.approved.mockReset();
    mocks.franchiseeRows = [FRANCHISEE];
  });

  it("is registered as the movein journal entries export", () => {
    expect(EXPORTS.journal_entries).toBe(journalEntriesExport);
    expect(journalEntriesExport.type).toBe("journal_entries");
    expect(journalEntriesExport.plugin).toBe("movein");
  });

  it("parses the params, loads and builds", async () => {
    mocks.approved.mockResolvedValue([approved("WOLT", 100), approved("HEVER", 200)]);
    const result = await journalEntriesExport.build({ franchiseeId: "fr-1", periodMonth: 9, periodYear: 2026 });
    expect(mocks.approved).toHaveBeenCalledWith({ franchiseeId: "fr-1", periodMonth: 9, periodYear: 2026 });
    expect(result.blockingErrors).toEqual([]);
    expect(result.rows.map((r) => [r.rowKey, r.companyId])).toEqual([
      ["c-WOLT|fr-1|2026-09|regular", "company-vini"],
      ["c-HEVER|fr-1|2026-09|hever_commission", "company-vini"],
      ["c-HEVER|fr-1|2026-09|hever_contra", "company-vini"],
    ]);
  });

  it("reports a missing franchisee as a blocking error without reading the period", async () => {
    mocks.franchiseeRows = [];
    const result = await journalEntriesExport.build({ franchiseeId: "nope", periodMonth: 9, periodYear: 2026 });
    expect(result).toEqual({ rows: [], blockingErrors: ["זכיין לא נמצא"] });
    expect(mocks.approved).not.toHaveBeenCalled();
  });

  it("rejects params that fail the schema before reading anything", async () => {
    await expect(journalEntriesExport.build({ franchiseeId: "", periodMonth: 9, periodYear: 2026 })).rejects.toThrow();
    await expect(journalEntriesExport.build({ franchiseeId: "f", periodMonth: 13, periodYear: 2026 })).rejects.toThrow();
    expect(mocks.approved).not.toHaveBeenCalled();
  });
});
