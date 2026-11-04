import { describe, it, expect } from "vitest";
import {
  exportTypeSchema,
  exportParamsSchema,
  previewRequestSchema,
  sendRequestSchema,
  resolveSendSchema,
  unlockRowSchema,
  companyPatchSchema,
  mappingPatchSchema,
  sendsListQuerySchema,
} from "@/schemas/hashavshevet";

const royaltiesParams = { year: 2026, month: 9, brandId: "b1", itemType: "royalty" };
const expected = [{ rowKey: "k1", amount: 100.5, companyId: "c1" }];

describe("resolveSendSchema", () => {
  it("rejects a rejection without a note", () => {
    expect(resolveSendSchema.safeParse({ outcome: "rejected" }).success).toBe(false);
    expect(resolveSendSchema.safeParse({ outcome: "rejected", note: "ab" }).success).toBe(false);
  });
  it("accepts a rejection with a note", () => {
    expect(resolveSendSchema.safeParse({ outcome: "rejected", note: "סכום לא תואם" }).success).toBe(true);
  });
  it("accepts arrived and approved without a note", () => {
    expect(resolveSendSchema.safeParse({ outcome: "arrived" }).success).toBe(true);
    expect(resolveSendSchema.safeParse({ outcome: "approved" }).success).toBe(true);
  });
  it("rejects an unknown outcome", () => {
    expect(resolveSendSchema.safeParse({ outcome: "unknown" }).success).toBe(false);
  });
});

describe("sendRequestSchema", () => {
  it("requires at least one expected row", () => {
    const r = sendRequestSchema.safeParse({ exportType: "royalties", params: royaltiesParams, expected: [] });
    expect(r.success).toBe(false);
  });
  it("accepts a valid send request", () => {
    const r = sendRequestSchema.safeParse({ exportType: "royalties", params: royaltiesParams, expected });
    expect(r.success).toBe(true);
  });
  it("rejects an empty rowKey", () => {
    const r = sendRequestSchema.safeParse({
      exportType: "royalties",
      params: royaltiesParams,
      expected: [{ rowKey: "", amount: 1, companyId: "c1" }],
    });
    expect(r.success).toBe(false);
  });
  it("requires each expected row's company, so a mapping change since the preview is caught (M8)", () => {
    for (const companyId of [undefined, null, ""]) {
      const r = sendRequestSchema.safeParse({
        exportType: "royalties",
        params: royaltiesParams,
        expected: [{ rowKey: "k1", amount: 1, companyId }],
      });
      expect(r.success).toBe(false);
    }
  });
});

describe("exportTypeSchema", () => {
  it("knows exactly the six exports", () => {
    expect(exportTypeSchema.options).toHaveLength(6);
    expect(exportTypeSchema.safeParse("royalties").success).toBe(true);
    expect(exportTypeSchema.safeParse("excel").success).toBe(false);
  });
});

describe("exportParamsSchema (discriminated union on exportType)", () => {
  it("rejects an unknown exportType", () => {
    expect(exportParamsSchema.safeParse({ exportType: "bank", params: {} }).success).toBe(false);
  });
  it("rejects journal_entries without franchiseeId", () => {
    const r = exportParamsSchema.safeParse({
      exportType: "journal_entries",
      params: { periodMonth: 9, periodYear: 2026 },
    });
    expect(r.success).toBe(false);
  });
  it("rejects periodMonth 13 and 0", () => {
    for (const periodMonth of [13, 0]) {
      const r = exportParamsSchema.safeParse({
        exportType: "franchisee_client_invoices",
        params: { franchiseeId: "f1", periodMonth, periodYear: 2026 },
      });
      expect(r.success).toBe(false);
    }
  });
  it("accepts journal_entries and franchisee_client_invoices params", () => {
    for (const exportType of ["journal_entries", "franchisee_client_invoices"]) {
      const r = exportParamsSchema.safeParse({
        exportType,
        params: { franchiseeId: "f1", periodMonth: 9, periodYear: 2026 },
      });
      expect(r.success).toBe(true);
    }
  });
  it("supplier_commissions applies route defaults", () => {
    const r = exportParamsSchema.parse({
      exportType: "supplier_commissions",
      params: { startDate: "2026-07-01", endDate: "2026-09-30" },
    });
    expect(r.exportType).toBe("supplier_commissions");
    if (r.exportType === "supplier_commissions") {
      expect(r.params.startDocNumber).toBe(5001);
      expect(r.params.onlyApproved).toBe(true);
    }
  });
  it("supplier_commissions rejects slash dates", () => {
    const r = exportParamsSchema.safeParse({
      exportType: "supplier_commissions",
      params: { startDate: "01/07/2026", endDate: "2026-09-30" },
    });
    expect(r.success).toBe(false);
  });
  it("royalties reuses the billing file-export query (no mode key)", () => {
    expect(exportParamsSchema.safeParse({ exportType: "royalties", params: royaltiesParams }).success).toBe(true);
    const bad = { ...royaltiesParams, itemType: "bonus" };
    expect(exportParamsSchema.safeParse({ exportType: "royalties", params: bad }).success).toBe(false);
  });
  it("client_commissions defaults docKind to invoice and rejects others", () => {
    const ok = exportParamsSchema.parse({ exportType: "client_commissions", params: { sessionId: "s1" } });
    if (ok.exportType === "client_commissions") expect(ok.params.docKind).toBe("invoice");
    const bad = exportParamsSchema.safeParse({
      exportType: "client_commissions",
      params: { sessionId: "s1", docKind: "receipt" },
    });
    expect(bad.success).toBe(false);
  });
  it("client_commission_invoices: franchiseeId optional, period required", () => {
    const base = { periodMonth: 9, periodYear: 2026 };
    expect(exportParamsSchema.safeParse({ exportType: "client_commission_invoices", params: base }).success).toBe(true);
    const bad = exportParamsSchema.safeParse({ exportType: "client_commission_invoices", params: { periodMonth: 9 } });
    expect(bad.success).toBe(false);
  });
});

describe("previewRequestSchema", () => {
  it("is the same shape as exportParamsSchema", () => {
    const body = { exportType: "client_commissions", params: { sessionId: "s1" } };
    expect(previewRequestSchema.safeParse(body).success).toBe(true);
  });
});

describe("unlockRowSchema", () => {
  it("requires a trimmed reason of at least 3 chars", () => {
    expect(unlockRowSchema.safeParse({ reason: "  ab " }).success).toBe(false);
    expect(unlockRowSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(unlockRowSchema.safeParse({ reason: "נשלח בטעות" }).success).toBe(true);
  });
});

describe("companyPatchSchema", () => {
  it("accepts ISO liveFrom, null and omitted", () => {
    expect(companyPatchSchema.safeParse({ liveFrom: "2026-10-31" }).success).toBe(true);
    expect(companyPatchSchema.safeParse({ liveFrom: null }).success).toBe(true);
    expect(companyPatchSchema.safeParse({ requiresApproval: false }).success).toBe(true);
  });
  it("rejects dd/mm/yyyy", () => {
    expect(companyPatchSchema.safeParse({ liveFrom: "31/10/2026" }).success).toBe(false);
  });
});

describe("mappingPatchSchema", () => {
  it("accepts brand or franchisee with a nullable companyId", () => {
    expect(mappingPatchSchema.safeParse({ kind: "brand", id: "b1", companyId: null }).success).toBe(true);
    expect(mappingPatchSchema.safeParse({ kind: "franchisee", id: "f1", companyId: "c1" }).success).toBe(true);
    expect(mappingPatchSchema.safeParse({ kind: "client", id: "x", companyId: null }).success).toBe(false);
  });
});

describe("sendsListQuerySchema", () => {
  it("validates status against the shared status list", () => {
    expect(sendsListQuerySchema.safeParse({ status: "awaiting_approval" }).success).toBe(true);
    expect(sendsListQuerySchema.safeParse({ status: "done" }).success).toBe(false);
    expect(sendsListQuerySchema.safeParse({}).success).toBe(true);
  });
});
