import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrandExportContext, ExportBillingRow } from "@/app/api/franchisee-billing/hashavshevet-export/route";
import {
  buildRoyaltiesRows,
  loadRoyaltiesData,
  royaltiesExport,
  type RoyaltiesData,
} from "@/lib/hashavshevet/builders/royalties";
import { EXPORTS } from "@/lib/hashavshevet/registry";

const { readBrandContexts, readBrandCompanyId } = vi.hoisted(() => ({
  readBrandContexts: vi.fn(),
  readBrandCompanyId: vi.fn(),
}));

vi.mock("@/data-access/franchisee-billing-export", () => ({
  createHashavshevetExportOperations: async () => ({ readBrandContexts }),
  readBrandCompanyId,
}));

function billing(over: Partial<ExportBillingRow> = {}): ExportBillingRow {
  return {
    billingId: "billing-1",
    franchiseeId: "franchisee-1",
    franchiseeName: "אושיבה",
    accountKeySnapshot: "אושיבה",
    status: "approved",
    noRevenueReason: null,
    royalty: "48228.82838983051",
    marketing: "1000",
    total: "49228.82838983051",
    ...over,
  };
}

function context(rows: ExportBillingRow[] = [billing()]): BrandExportContext {
  return { brandId: "brand-1", brandCode: "MINNA_TOMEI", brandName: "מינה טומאיי", rows };
}

function data(over: Partial<RoyaltiesData> = {}): RoyaltiesData {
  return { context: context(), companyId: "company-1", itemType: "royalty", year: 2026, month: 6, ...over };
}

const DISPLAY_COLUMNS = [
  "מפתח חשבון",
  "שם",
  "מפתח פריט",
  "שם פריט",
  "כמות",
  "מחיר",
  "סוג המסמך",
  "מספר מסמך",
  "פרטים",
];

describe("buildRoyaltiesRows", () => {
  it("builds the row key, document key, company, amount and excel columns", () => {
    const { rows, blockingErrors } = buildRoyaltiesRows(data());

    expect(blockingErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.rowKey).toBe("franchisee-1|2026-06|royalty");
    expect(row.documentKey).toBe(row.rowKey);
    expect(row.companyId).toBe("company-1");
    expect(row.amount).toBe(48228.82838983051);
    expect(Object.keys(row.display)).toEqual(DISPLAY_COLUMNS);
    expect(Object.values(row.display)).toEqual(["אושיבה", "", "הכנסותת", "", 1, 48228.82838983051, "11", "5000", ""]);
  });

  it("leaves companyId null when the brand is not mapped", () => {
    expect(buildRoyaltiesRows(data({ companyId: null })).rows[0].companyId).toBeNull();
  });

  it("uses the marketing item key and amount for marketing", () => {
    const [row] = buildRoyaltiesRows(data({ itemType: "marketing" })).rows;
    expect(row.rowKey).toBe("franchisee-1|2026-06|marketing");
    expect(row.amount).toBe(1000);
    expect(row.display["מפתח פריט"]).toBe("שיווק");
    expect(row.apiRow.itemkey).toBe("שיווק");
  });

  it.each([
    [2026, 6, "2026-06-30"],
    [2026, 2, "2026-02-28"],
    [2028, 2, "2028-02-29"],
    [2026, 12, "2026-12-31"],
    [2026, 1, "2026-01-31"],
  ])("periodEnd for %i-%i is the last day of the month", (year, month, expected) => {
    expect(buildRoyaltiesRows(data({ year, month })).rows[0].periodEnd).toBe(expected);
  });

  it("builds the imovein apiRow as exact strings, without valueDate or empty details", () => {
    const [row] = buildRoyaltiesRows(data()).rows;
    expect(row.apiRow).toEqual({
      accountKey: "אושיבה",
      itemkey: "הכנסותת",
      Quantity: "1.000",
      price: "48228.83",
      DocumentID: "1",
      Reference: "5000",
    });
  });

  it("keeps hebrew quote and geresh characters in the account key untouched", () => {
    const rows = [
      billing({ franchiseeId: "f-a", billingId: "b-a", accountKeySnapshot: 'מע"מ ויני ע' }),
    ];
    const [row] = buildRoyaltiesRows(data({ context: context(rows) })).rows;
    expect(row.apiRow.accountKey).toBe('מע"מ ויני ע');
  });

  it("orders by the account order, skips zero amounts, and numbers references from 5000", () => {
    const rows = [
      billing({ franchiseeId: "f-kk", billingId: "b-kk", franchiseeName: "ק", accountKeySnapshot: "ק.ק מסעדה", royalty: "300" }),
      billing({ franchiseeId: "f-zero", billingId: "b-zero", franchiseeName: "ז", accountKeySnapshot: "קינג מ", royalty: "0" }),
      billing({ franchiseeId: "f-osh", billingId: "b-osh", franchiseeName: "א", accountKeySnapshot: "אושיבה", royalty: "100" }),
    ];
    const built = buildRoyaltiesRows(data({ context: context(rows) })).rows;
    expect(built.map((r) => [r.rowKey, r.apiRow.Reference, r.apiRow.price])).toEqual([
      ["f-osh|2026-06|royalty", "5000", "100.00"],
      ["f-kk|2026-06|royalty", "5001", "300.00"],
    ]);
  });

  it("returns a blocking error, not a throw, when the brand is incomplete", () => {
    const rows = [billing(), billing({ franchiseeId: "f-2", billingId: "b-2", franchiseeName: "מינה", status: "draft" })];
    const result = buildRoyaltiesRows(data({ context: context(rows) }));
    expect(result.rows).toEqual([]);
    expect(result.blockingErrors).toEqual(["לא ניתן לייצא מינה טומאיי: 1/2. חסרים: מינה"]);
  });

  it("returns a blocking error when the brand does not exist", () => {
    const result = buildRoyaltiesRows(data({ context: null }));
    expect(result.rows).toEqual([]);
    expect(result.blockingErrors).toEqual(["המותג שנבחר לא נמצא"]);
  });

  it("turns invalid export data into a blocking error", () => {
    const rows = [billing({ accountKeySnapshot: null })];
    const result = buildRoyaltiesRows(data({ context: context(rows) }));
    expect(result.rows).toEqual([]);
    expect(result.blockingErrors).toEqual(["מפתח החשבון של אושיבה חסר בצילום האישור"]);
  });
});

describe("royaltiesExport", () => {
  beforeEach(() => {
    readBrandContexts.mockReset();
    readBrandCompanyId.mockReset();
  });

  it("is registered as the imovein royalties export", () => {
    expect(EXPORTS.royalties).toBe(royaltiesExport);
    expect(royaltiesExport.type).toBe("royalties");
    expect(royaltiesExport.plugin).toBe("imovein");
  });

  it("loads the requested brand's context and company, and builds rows from them", async () => {
    readBrandContexts.mockResolvedValue([
      { ...context(), brandId: "other-brand", rows: [] },
      context(),
    ]);
    readBrandCompanyId.mockResolvedValue("company-9");

    const result = await royaltiesExport.build({ year: 2026, month: 6, brandId: "brand-1", itemType: "royalty" });

    expect(readBrandContexts).toHaveBeenCalledWith({ year: 2026, month: 6 });
    expect(readBrandCompanyId).toHaveBeenCalledWith("brand-1");
    expect(result.blockingErrors).toEqual([]);
    expect(result.rows.map((r) => [r.rowKey, r.companyId])).toEqual([["franchisee-1|2026-06|royalty", "company-9"]]);
  });

  it("reports an unknown brand as a blocking error", async () => {
    readBrandContexts.mockResolvedValue([context()]);
    readBrandCompanyId.mockResolvedValue(null);
    const result = await royaltiesExport.build({ year: 2026, month: 6, brandId: "missing", itemType: "royalty" });
    expect(result).toEqual({ rows: [], blockingErrors: ["המותג שנבחר לא נמצא"] });
  });

  it("rejects params that fail the schema before touching the database", async () => {
    await expect(loadRoyaltiesData({ year: 2026, month: 13, brandId: "brand-1", itemType: "royalty" })).rejects.toThrow();
    expect(readBrandContexts).not.toHaveBeenCalled();
  });
});
