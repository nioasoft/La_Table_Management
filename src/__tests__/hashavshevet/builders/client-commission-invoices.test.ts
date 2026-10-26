import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommissionInvoiceExportRow } from "@/data-access/commission-invoices";
import {
  buildClientCommissionInvoicesRows,
  clientCommissionInvoicesExport,
  type ClientCommissionInvoicesData,
} from "@/lib/hashavshevet/builders/client-commission-invoices";
import { copy } from "@/lib/hashavshevet/copy";
import { EXPENSE_JOURNAL_TRANS_TYPE, internalReference, REFERENCE_PREFIX } from "@/lib/hashavshevet/format";
import { EXPORTS } from "@/lib/hashavshevet/registry";

// The two reads behind the loader are mocked; nothing reaches a real database.
const mocks = vi.hoisted(() => ({ invoices: vi.fn(), vatRate: vi.fn() }));
vi.mock("@/db", () => ({ database: {} }));
vi.mock("@/data-access/commission-invoices", () => ({ getCommissionInvoicesForExport: mocks.invoices }));
vi.mock("@/data-access/vatRates", () => ({ getVatRateForDate: mocks.vatRate }));

const COLUMNS = [
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
    clientHashavshevet: { name: "שם לקוח", hashavshevetCode: null, hashavshevetName: "חן לקוח", hashavshevetByBrand: null },
    franchiseeId: "fr-1",
    franchiseeName: "ויני חדרה",
    brandId: "b-vini",
    franchiseeHashavshevetCompanyId: "company-vini",
    ...over,
  };
}

function data(over: Partial<ClientCommissionInvoicesData> = {}): ClientCommissionInvoicesData {
  return { periodMonth: 9, periodYear: 2026, rows: [invoice()], vatRate: 0.18, ...over };
}

const rowsOf = (over: Partial<ClientCommissionInvoicesData> = {}) => buildClientCommissionInvoicesRows(data(over)).rows;
const cents = (money: string) => Math.round(Number(money) * 100);

describe("buildClientCommissionInvoicesRows", () => {
  it("keys a row by its client document id, on the franchisee's company", () => {
    const { rows, blockingErrors } = buildClientCommissionInvoicesRows(data());
    expect(blockingErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.rowKey).toBe("doc-1");
    expect(row.documentKey).toBe("doc-1");
    expect(row.companyId).toBe("company-vini");
    expect(row.amount).toBe(1180);
    expect(row.periodEnd).toBe("2026-09-30");
  });

  it("leaves companyId null when the franchisee has no Hashavshevet company", () => {
    const [row] = rowsOf({ rows: [invoice({ franchiseeHashavshevetCompanyId: null })] });
    expect(row.companyId).toBeNull();
  });

  it("gives each document its own key and reference, even for the same client and franchisee", () => {
    const rows = rowsOf({ rows: [invoice({ invoiceDocumentId: "doc-1" }), invoice({ invoiceDocumentId: "doc-2" })] });
    expect(rows.map((r) => r.rowKey)).toEqual(["doc-1", "doc-2"]);
    expect(new Set(rows.map((r) => r.apiRow.Reference)).size).toBe(2);
  });

  it("dates the row at the period's real last day", () => {
    const [row] = rowsOf({ periodMonth: 2, periodYear: 2028 });
    expect(row.periodEnd).toBe("2028-02-29");
    expect(row.apiRow).toMatchObject({ ValueDate: "29/02/2028", DueDate: "29/02/2028", Details: "עמלה פברואר" });
  });

  it("shows the Excel's eleven columns with the Excel's values: serial dates, G and H split from I", () => {
    const [row] = rowsOf({
      rows: [invoice({ invoiceNumber: "INV-778899", allocationNumber: "012345678", totalAmountWithVat: 1234.57 })],
    });
    expect(Object.keys(row.display)).toEqual(COLUMNS);
    expect(Object.values(row.display)).toEqual([
      "8899", SEP_30_2026, SEP_30_2026, "עמלות מלקוחות", "מעמתש", "חן לקוח", 1046.25, 188.32, 1234.57, "עמלה ספטמבר", "012345678",
    ]);
  });

  it("builds the movein row as exact strings, with the allocation number kept as a string", () => {
    const [row] = rowsOf({
      rows: [invoice({ invoiceNumber: "INV-778899", allocationNumber: "012345678", totalAmountWithVat: 1234.57 })],
    });
    expect(row.apiRow).toEqual({
      TransType: "הוצ",
      Reference: internalReference("LT", "doc-1"),
      Ref2: "8899",
      ValueDate: "30/09/2026",
      DueDate: "30/09/2026",
      AccountKeyDeb1: "עמלות מלקוחות",
      AccountKeyDeb2: "מעמתש",
      AccountKeyCred1: "חן לקוח",
      SuFDeb1: "1046.25",
      SuFDeb2: "188.32",
      SuFCred1: "1234.57",
      Details: "עמלה ספטמבר",
      TaxAPINumber: "012345678",
    });
  });

  it("omits Ref2 and TaxAPINumber when the invoice has no number and no allocation", () => {
    const [row] = rowsOf({ rows: [invoice({ invoiceNumber: null, allocationNumber: null, totalAmountWithVat: 59.99 })] });
    expect(row.apiRow).toEqual({
      TransType: "הוצ",
      Reference: internalReference("LT", "doc-1"),
      ValueDate: "30/09/2026",
      DueDate: "30/09/2026",
      AccountKeyDeb1: "עמלות מלקוחות",
      AccountKeyDeb2: "מעמתש",
      AccountKeyCred1: "חן לקוח",
      SuFDeb1: "50.84",
      SuFDeb2: "9.15",
      SuFCred1: "59.99",
      Details: "עמלה ספטמבר",
    });
    expect(row.apiRow).not.toHaveProperty("Ref2");
    expect(row.apiRow).not.toHaveProperty("TaxAPINumber");
    expect(Object.values(row.apiRow).every((v) => typeof v === "string" && v !== "")).toBe(true);
  });

  it("credits the client's account for the row's brand", () => {
    const client = { name: "גיפט", hashavshevetCode: "GIFT", hashavshevetName: null, hashavshevetByBrand: { "b-mina": "חשבון מינה" } };
    const rows = rowsOf({
      rows: [
        invoice({ invoiceDocumentId: "d-vini", brandId: "b-vini", clientHashavshevet: client }),
        invoice({ invoiceDocumentId: "d-mina", brandId: "b-mina", clientHashavshevet: client }),
      ],
    });
    expect(rows.map((r) => [r.apiRow.AccountKeyCred1, r.display["חן זכות"]])).toEqual([
      ["GIFT", "GIFT"],
      ["חשבון מינה", "חשבון מינה"],
    ]);
  });

  it("splits at the loaded VAT rate", () => {
    const [row] = rowsOf({ rows: [invoice({ totalAmountWithVat: 1170 })], vatRate: 0.17 });
    expect(row.apiRow).toMatchObject({ SuFDeb1: "1000.00", SuFDeb2: "170.00", SuFCred1: "1170.00" });
  });

  it("is an expense entry (R24) sent on the shared reference prefix", () => {
    expect(EXPENSE_JOURNAL_TRANS_TYPE).toBe("הוצ");
    expect(REFERENCE_PREFIX).toBe("LT");
    const [row] = rowsOf();
    expect(row.apiRow.TransType).toBe(EXPENSE_JOURNAL_TRANS_TYPE);
    expect(row.apiRow.Reference).toBe(internalReference(REFERENCE_PREFIX, row.rowKey));
  });

  it.each([0.18, 0.17])("balances every entry to the agora at VAT %s: SuFDeb1 + SuFDeb2 === SuFCred1", (vatRate) => {
    const awkward = [0.01, 0.05, 0.99, 1, 1.17, 1.18, 99.99, 1234.57, 4999.995, 100000, 77777.77];
    const totals = [...awkward];
    for (let c = 1; c <= 10_000_000; c += 997) totals.push(c / 100);
    const rows = rowsOf({
      vatRate,
      rows: totals.map((total, n) => invoice({ invoiceDocumentId: `doc-${n}`, totalAmountWithVat: total })),
    });
    expect(rows).toHaveLength(totals.length);
    for (const { apiRow } of rows) {
      expect(cents(apiRow.SuFDeb1) + cents(apiRow.SuFDeb2), JSON.stringify(apiRow)).toBe(cents(apiRow.SuFCred1));
      expect(apiRow.SuFCred1).toMatch(/^\d+\.\d{2}$/);
    }
  });

  describe("a total that rounds to 0.00", () => {
    // The Excel keeps such a row (it only drops totals <= 0 before rounding), so the API path
    // blocks the whole send instead of letting an empty journal line reach Hashavshevet.
    it("stays in the rows, as in the Excel, and blocks the send naming the invoice", () => {
      const { rows, blockingErrors } = buildClientCommissionInvoicesRows(
        data({
          rows: [
            invoice({ invoiceDocumentId: "d-ok", totalAmountWithVat: 500 }),
            invoice({ invoiceDocumentId: "d-zero", invoiceNumber: "INV-0042", totalAmountWithVat: 0.004 }),
          ],
        }),
      );
      expect(rows.map((r) => r.rowKey)).toEqual(["d-ok", "d-zero"]);
      expect(rows[1].amount).toBe(0);
      expect(blockingErrors).toEqual([copy.zeroCommissionInvoice("INV-0042", "שם לקוח", "ויני חדרה")]);
      expect(blockingErrors[0]).toContain("INV-0042");
      expect(blockingErrors[0]).toContain("0.00");
    });

    it("names the client and says there is no number when the invoice has none", () => {
      const { blockingErrors } = buildClientCommissionInvoicesRows(
        data({ rows: [invoice({ invoiceNumber: null, totalAmountWithVat: 0.004 })] }),
      );
      expect(blockingErrors).toEqual([copy.zeroCommissionInvoice(null, "שם לקוח", "ויני חדרה")]);
      expect(blockingErrors[0]).toContain("ללא מספר");
    });

    it("does not block 0.01, the smallest total that still books", () => {
      const { rows, blockingErrors } = buildClientCommissionInvoicesRows(data({ rows: [invoice({ totalAmountWithVat: 0.01 })] }));
      expect(blockingErrors).toEqual([]);
      expect(rows[0].apiRow).toMatchObject({ SuFDeb1: "0.01", SuFDeb2: "0.00", SuFCred1: "0.01" });
    });
  });

  it("reports an empty period as a blocking error with the Excel route's text", () => {
    expect(buildClientCommissionInvoicesRows(data({ rows: [] }))).toEqual({
      rows: [],
      blockingErrors: ["אין חשבוניות עמלה לתקופה הנבחרת"],
    });
  });
});

describe("clientCommissionInvoicesExport", () => {
  beforeEach(() => {
    mocks.invoices.mockReset();
    mocks.vatRate.mockReset();
    mocks.vatRate.mockResolvedValue(0.18);
  });

  it("is registered as the movein client commission invoices export", () => {
    expect(EXPORTS.client_commission_invoices).toBe(clientCommissionInvoicesExport);
    expect(clientCommissionInvoicesExport.type).toBe("client_commission_invoices");
    expect(clientCommissionInvoicesExport.plugin).toBe("movein");
  });

  it("parses the params, loads (with the franchisee filter) and builds", async () => {
    mocks.invoices.mockResolvedValue([invoice({ invoiceDocumentId: "doc-7" })]);
    const result = await clientCommissionInvoicesExport.build({ periodMonth: 9, periodYear: 2026, franchiseeId: "fr-1" });
    expect(mocks.invoices).toHaveBeenCalledWith(9, 2026, "fr-1");
    expect(mocks.vatRate).toHaveBeenCalledWith(new Date(2026, 9, 0));
    expect(result.blockingErrors).toEqual([]);
    expect(result.rows.map((r) => [r.rowKey, r.companyId])).toEqual([["doc-7", "company-vini"]]);
  });

  it("loads every franchisee when none is given", async () => {
    mocks.invoices.mockResolvedValue([invoice()]);
    await clientCommissionInvoicesExport.build({ periodMonth: 9, periodYear: 2026 });
    expect(mocks.invoices).toHaveBeenCalledWith(9, 2026, null);
  });

  it("rejects params that fail the schema before reading anything", async () => {
    await expect(clientCommissionInvoicesExport.build({ periodMonth: 13, periodYear: 2026 })).rejects.toThrow();
    await expect(clientCommissionInvoicesExport.build({ periodMonth: 9 })).rejects.toThrow();
    expect(mocks.invoices).not.toHaveBeenCalled();
  });
});
