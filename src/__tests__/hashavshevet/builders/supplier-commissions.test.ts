import { describe, expect, it, vi } from "vitest";

import type { SupplierFileProcessingResult } from "@/db/schema";
import {
  buildSupplierCommissionsRows,
  supplierCommissionsExport,
  type SupplierCommissionFile,
  type SupplierCommissionsData,
} from "@/lib/hashavshevet/builders/supplier-commissions";
import { EXCEL_TO_API_DOCUMENT_ID } from "@/lib/hashavshevet/format";
import { EXPORTS } from "@/lib/hashavshevet/registry";

// Every query resolves to no rows; nothing reaches a real database.
const db = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/db", () => {
  const chain: Record<string, unknown> = {};
  for (const step of ["from", "innerJoin", "where"]) chain[step] = () => chain;
  chain.then = (resolve: (rows: unknown[]) => void) => {
    db.calls++;
    resolve([]);
  };
  return { database: { select: () => chain, execute: async () => ({ rows: [] }) } };
});

type Match = SupplierFileProcessingResult["franchiseeMatches"][number];

function match(franchiseeId: string, netAmount: number): Match {
  return {
    originalName: franchiseeId,
    rowNumber: 1,
    grossAmount: netAmount,
    netAmount,
    matchedFranchiseeId: franchiseeId,
    matchedFranchiseeName: franchiseeId,
    confidence: 1,
    matchType: "exact",
    requiresReview: false,
  };
}

function file(over: Partial<SupplierCommissionFile> & { matches: Match[] }): SupplierCommissionFile {
  const { matches, ...rest } = over;
  return {
    fileId: "file-1",
    supplierId: "s-tnuva",
    supplierName: "תנובה",
    supplierCode: "TNUVA",
    hashavshevetCode: "60001",
    commissionRate: "10",
    commissionType: "percentage",
    settlementFrequency: "monthly",
    processingResult: { franchiseeMatches: matches } as SupplierFileProcessingResult,
    periodStartDate: "2026-09-01",
    periodEndDate: "2026-09-30",
    ...rest,
  };
}

function data(files: SupplierCommissionFile[], over: Partial<SupplierCommissionsData> = {}): SupplierCommissionsData {
  return {
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    brandIds: [],
    supplierIds: [],
    startDocNumber: 5001,
    onlyApproved: false,
    files,
    franchisees: [
      { id: "f-hadera", name: "ויני חדרה", brandId: "b-vini", hashavshevetItemKey: null },
      { id: "f-karmiel", name: "ויני כרמיאל", brandId: "b-vini", hashavshevetItemKey: 'מע"מ ויני כ' },
      { id: "f-sarona", name: "מינה שרונה", brandId: "b-mina", hashavshevetItemKey: null },
    ],
    brands: [
      { id: "b-vini", nameHe: "פט ויני", hashavshevetCompanyId: "company-panikon" },
      { id: "b-mina", nameHe: "מינה טומאיי", hashavshevetCompanyId: null },
    ],
    approvedKeys: new Set(),
    ...over,
  };
}

const COLUMNS = ["מפתח חשבון", "שם", "מפתח פריט", "שם פריט", "כמות", "מחיר", "סוג המסמך", "מספר מסמך"];

describe("buildSupplierCommissionsRows", () => {
  it("keys a row by supplier|franchisee|periodStart|periodEnd, with the brand's company", () => {
    const { rows, blockingErrors } = buildSupplierCommissionsRows(data([file({ matches: [match("f-hadera", 2000)] })]));

    expect(blockingErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.rowKey).toBe("s-tnuva|f-hadera|2026-09-01|2026-09-30");
    expect(row.documentKey).toBe(row.rowKey);
    expect(row.companyId).toBe("company-panikon");
    expect(row.periodEnd).toBe("2026-09-30");
    expect(row.amount).toBe(200);
    expect(Object.keys(row.display)).toEqual(COLUMNS);
    expect(Object.values(row.display)).toEqual(["60001", "", "עמלות ויני חדרה", "", 1, 200, 11, "5001"]);
  });

  it("leaves companyId null when the franchisee's brand is not mapped", () => {
    const [row] = buildSupplierCommissionsRows(data([file({ matches: [match("f-sarona", 2000)] })])).rows;
    expect(row.companyId).toBeNull();
  });

  it("builds the imovein apiRow as exact strings, without valueDate", () => {
    const [, row] = buildSupplierCommissionsRows(
      data([file({ matches: [match("f-hadera", 2000), match("f-karmiel", 12345)] })], { startDocNumber: 7001 }),
    ).rows;
    expect(row.apiRow).toEqual({
      accountKey: "60001",
      itemkey: 'מע"מ ויני כ',
      Quantity: "1.000",
      price: "1235.00",
      DocumentID: "1",
      Reference: "7002",
    });
  });

  it("never makes the Excel path depend on the API mapping: no DocumentID means no apiRow, not a throw (M7)", () => {
    const mapping = EXCEL_TO_API_DOCUMENT_ID as Record<number, string>;
    const saved = mapping[11];
    delete mapping[11];
    try {
      const { rows, blockingErrors } = buildSupplierCommissionsRows(data([file({ matches: [match("f-hadera", 2000)] })]));
      expect(blockingErrors).toEqual([]);
      expect(rows[0].apiRow).toEqual({});
      expect(Object.values(rows[0].display)).toEqual(["60001", "", "עמלות ויני חדרה", "", 1, 200, 11, "5001"]);
    } finally {
      mapping[11] = saved;
    }
  });

  it("aggregates the same supplier x franchisee x period, and keeps another period apart", () => {
    const files = [
      file({ matches: [match("f-hadera", 1004), match("f-hadera", 1004)] }),
      file({ fileId: "file-2", settlementFrequency: "bi_weekly", periodStartDate: "2026-09-16", periodEndDate: "2026-09-30", matches: [match("f-hadera", 500)] }),
      file({ fileId: "file-3", settlementFrequency: "bi_weekly", periodStartDate: "2026-09-01", periodEndDate: "2026-09-15", matches: [match("f-hadera", 300)] }),
    ];
    const { rows } = buildSupplierCommissionsRows(data(files));
    expect(rows.map((r) => [r.rowKey, r.amount, r.apiRow.Reference])).toEqual([
      ["s-tnuva|f-hadera|2026-09-01|2026-09-30", 200, "5001"],
      ["s-tnuva|f-hadera|2026-09-16|2026-09-30", 50, "5002"],
      ["s-tnuva|f-hadera|2026-09-01|2026-09-15", 30, "5003"],
    ]);
  });

  it("numbers each brand from startDocNumber for all networks, like the per-brand excel files", () => {
    const files = [file({ matches: [match("f-hadera", 1000), match("f-sarona", 2000), match("f-karmiel", 3000)] })];
    const perBrand = buildSupplierCommissionsRows(data(files)).rows;
    expect(perBrand.map((r) => [r.rowKey.split("|")[1], r.apiRow.Reference])).toEqual([
      ["f-hadera", "5001"],
      ["f-karmiel", "5002"],
      ["f-sarona", "5001"],
    ]);
    const explicit = buildSupplierCommissionsRows(data(files, { brandIds: ["b-vini", "b-mina"] })).rows;
    expect(explicit.map((r) => [r.rowKey.split("|")[1], r.apiRow.Reference])).toEqual([
      ["f-hadera", "5001"],
      ["f-sarona", "5002"],
      ["f-karmiel", "5003"],
    ]);
  });

  it("blocks with the excel route's message when a supplier has no hashavshevet code", () => {
    const files = [
      file({ matches: [match("f-hadera", 1000)] }),
      file({ fileId: "file-2", supplierId: "s-z", supplierName: "תפוזינה", hashavshevetCode: null, matches: [match("f-hadera", 1000)] }),
      file({ fileId: "file-3", supplierId: "s-a", supplierName: "אסם", hashavshevetCode: "", matches: [match("f-sarona", 1000)] }),
    ];
    expect(buildSupplierCommissionsRows(data(files))).toEqual({
      rows: [],
      blockingErrors: ["לא ניתן לייצא — יש ספקים ללא כרטיס חשבשבת: אסם, תפוזינה"],
    });
  });

  it("applies the approval gate when onlyApproved is on", () => {
    const files = [file({ matches: [match("f-hadera", 1000), match("f-karmiel", 2000)] })];
    const approvedKeys = new Set(["s-tnuva|f-karmiel|2026-09-01|2026-09-30"]);
    const { rows } = buildSupplierCommissionsRows(data(files, { onlyApproved: true, approvedKeys }));
    expect(rows.map((r) => r.rowKey)).toEqual(["s-tnuva|f-karmiel|2026-09-01|2026-09-30"]);
  });
});

describe("supplierCommissionsExport", () => {
  it("is registered as the imovein supplier commissions export", () => {
    expect(EXPORTS.supplier_commissions).toBe(supplierCommissionsExport);
    expect(supplierCommissionsExport.type).toBe("supplier_commissions");
    expect(supplierCommissionsExport.plugin).toBe("imovein");
  });

  it("parses the params, loads and builds", async () => {
    db.calls = 0;
    const result = await supplierCommissionsExport.build({ startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(result).toEqual({ rows: [], blockingErrors: [] });
    expect(db.calls).toBe(3); // files, franchisees, brands (no fresh sessions -> no comparison query)
  });

  it("rejects params that fail the schema before touching the database", async () => {
    db.calls = 0;
    await expect(supplierCommissionsExport.build({ startDate: "1.9.2026", endDate: "2026-09-30" })).rejects.toThrow();
    expect(db.calls).toBe(0);
  });
});
