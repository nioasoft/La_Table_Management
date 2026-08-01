import { describe, expect, it } from "vitest";
import {
  buildRoyaltyBillingPlan,
  createDraftBillingUpsertQuery,
  sourceReviewProcessingStatus,
  type BillingFranchisee,
  type DraftBillingCandidate,
  type StoredFranchiseeBilling,
} from "@/data-access/franchisee-billing";
import type { RoyaltyRevenueRow } from "@/lib/client-parsers/royalty-revenue-parser";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";

const PERIOD = { year: 2026, month: 6 } as const;

function revenueRow(
  overrides: Partial<RoyaltyRevenueRow> = {},
): RoyaltyRevenueRow {
  return {
    branchName: "VINNI יהוד",
    receipts: 1_000_000,
    tips: 30_000,
    period: PERIOD,
    missingBranchName: false,
    missingReceipts: false,
    missingTips: false,
    ...overrides,
  };
}

function franchisee(
  overrides: Partial<BillingFranchisee> = {},
): BillingFranchisee {
  return {
    id: "franchisee-1",
    brandId: "brand-vinni",
    managementCompanyId: null,
    category: "regular",
    name: "VINNI יהוד",
    code: "VINNI-YEHUD",
    aliases: ["ויני יהוד"],
    companyId: null,
    address: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    primaryContactName: null,
    primaryContactEmail: null,
    primaryContactPhone: null,
    owners: null,
    ownerName: null,
    contactEmail: null,
    contactPhone: null,
    openingDate: null,
    leaseOption1End: null,
    leaseOption2End: null,
    leaseOption3End: null,
    franchiseAgreementEnd: null,
    agreementStartDate: null,
    agreementEndDate: null,
    royaltyRate: null,
    marketingFeeRate: "1.00",
    royaltyTiers: [{ upTo: null, rate: 4 }],
    royaltyTierBasis: "gross",
    royaltyTiersConfirmed: true,
    royaltyTiersNote: null,
    royaltyIncludeTips: false,
    tipsAbsenceAcknowledged: false,
    hashavshevetAccountKey: null,
    status: "active",
    notes: null,
    hashavshevetItemKey: null,
    revenueAccountCode: null,
    hashavshevetRevenueAccount: null,
    isActive: true,
    isKosher: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    createdBy: null,
    ...overrides,
  };
}

describe("buildRoyaltyBillingPlan", () => {
  it("blocks an unmatched branch instead of creating a draft", () => {
    const plan = buildRoyaltyBillingPlan({
      rows: [revenueRow({ branchName: "סניף שאינו קיים" })],
      franchisees: [franchisee()],
      existingBillings: [],
      sourceFileId: "file-1",
      vat: 0.18,
      period: PERIOD,
    });

    expect(plan.drafts).toEqual([]);
    expect(plan.anomalies).toMatchObject([
      {
        code: "unmatched_branch",
        rowIndex: 0,
        branchName: "סניף שאינו קיים",
      },
    ]);
  });

  it("blocks a row resolved to an inactive franchisee", () => {
    const plan = buildRoyaltyBillingPlan({
      rows: [revenueRow()],
      franchisees: [
        franchisee({ status: "inactive", isActive: false }),
      ],
      existingBillings: [],
      sourceFileId: "file-1",
      vat: 0.18,
      period: PERIOD,
    });

    expect(plan.drafts).toEqual([]);
    expect(plan.anomalies[0]).toMatchObject({
      code: "inactive_franchisee",
      franchiseeId: "franchisee-1",
    });
  });

  it.each([
    {
      label: "missing tiers",
      overrides: { royaltyTiers: null },
    },
    {
      label: "unconfirmed tiers",
      overrides: { royaltyTiersConfirmed: false },
    },
  ])("blocks a franchisee with $label", ({ overrides }) => {
    const plan = buildRoyaltyBillingPlan({
      rows: [revenueRow()],
      franchisees: [franchisee(overrides)],
      existingBillings: [],
      sourceFileId: "file-1",
      vat: 0.18,
      period: PERIOD,
    });

    expect(plan.drafts).toEqual([]);
    expect(plan.anomalies[0]).toMatchObject({
      code: "unconfirmed_tiers",
      franchiseeId: "franchisee-1",
    });
  });

  it("blocks every row when two rows resolve to the same franchisee", () => {
    const plan = buildRoyaltyBillingPlan({
      rows: [
        revenueRow(),
        revenueRow({ branchName: "ויני יהוד" }),
      ],
      franchisees: [franchisee()],
      existingBillings: [],
      sourceFileId: "file-1",
      vat: 0.18,
      period: PERIOD,
    });

    expect(plan.drafts).toEqual([]);
    expect(plan.anomalies).toMatchObject([
      { code: "duplicate_franchisee", rowIndex: 0 },
      { code: "duplicate_franchisee", rowIndex: 1 },
    ]);
  });

  it("blocks a negative royalty base", () => {
    const plan = buildRoyaltyBillingPlan({
      rows: [revenueRow({ receipts: -1, tips: 0 })],
      franchisees: [franchisee()],
      existingBillings: [],
      sourceFileId: "file-1",
      vat: 0.18,
      period: PERIOD,
    });

    expect(plan.drafts).toEqual([]);
    expect(plan.anomalies[0]).toMatchObject({ code: "negative_base" });
  });

  it("reports every anomaly found on the same row", () => {
    const plan = buildRoyaltyBillingPlan({
      rows: [revenueRow({ receipts: -1, tips: 0 })],
      franchisees: [
        franchisee({ royaltyTiersConfirmed: false }),
      ],
      existingBillings: [],
      sourceFileId: "file-1",
      vat: 0.18,
      period: PERIOD,
    });

    expect(plan.drafts).toEqual([]);
    expect(plan.anomalies.map(({ code }) => code)).toEqual([
      "unconfirmed_tiers",
      "negative_base",
    ]);
  });

  it("blocks a blank branch name carrying an amount", () => {
    const plan = buildRoyaltyBillingPlan({
      rows: [
        revenueRow({
          branchName: "",
          missingBranchName: true,
          receipts: 2_694_724,
        }),
      ],
      franchisees: [franchisee()],
      existingBillings: [],
      sourceFileId: "file-1",
      vat: 0.18,
      period: PERIOD,
    });

    expect(plan.drafts).toEqual([]);
    expect(plan.anomalies[0]).toMatchObject({
      code: "missing_branch_name",
      rowIndex: 0,
    });
  });

  it("blocks included tips below one percent of receipts", () => {
    const plan = buildRoyaltyBillingPlan({
      rows: [revenueRow({ receipts: 2_192_380, tips: 18 })],
      franchisees: [franchisee({ royaltyIncludeTips: true })],
      existingBillings: [],
      sourceFileId: "file-1",
      vat: 0.18,
      period: PERIOD,
    });

    expect(plan.drafts).toEqual([]);
    expect(plan.anomalies[0]).toMatchObject({
      code: "tips_below_threshold",
      franchiseeId: "franchisee-1",
    });
  });

  it("allows low tips after the franchisee acknowledgment", () => {
    const plan = buildRoyaltyBillingPlan({
      rows: [revenueRow({ receipts: 2_192_380, tips: 18 })],
      franchisees: [
        franchisee({
          royaltyIncludeTips: true,
          tipsAbsenceAcknowledged: true,
        }),
      ],
      existingBillings: [],
      sourceFileId: "file-1",
      vat: 0.18,
      period: PERIOD,
    });

    expect(plan.anomalies).toEqual([]);
    expect(plan.drafts).toHaveLength(1);
  });

  it.each([
    {
      label: "receipts",
      row: revenueRow({ receipts: null, missingReceipts: true }),
    },
    {
      label: "tips",
      row: revenueRow({ tips: null, missingTips: true }),
    },
  ])("does not convert missing $label to zero", ({ row }) => {
    const plan = buildRoyaltyBillingPlan({
      rows: [row],
      franchisees: [franchisee()],
      existingBillings: [],
      sourceFileId: "file-1",
      vat: 0.18,
      period: PERIOD,
    });

    expect(plan.drafts).toEqual([]);
    expect(plan.anomalies[0]).toMatchObject({ code: "missing_amount" });
  });

  it("recalculates a draft using its stored discount rate points", () => {
    const existing = storedBilling({
      status: "draft",
      discountRatePoints: "1.00",
    });
    const plan = buildRoyaltyBillingPlan({
      rows: [revenueRow({ receipts: 118, tips: 0 })],
      franchisees: [franchisee()],
      existingBillings: [existing],
      sourceFileId: "file-2",
      vat: 0.18,
      period: PERIOD,
    });

    expect(plan.anomalies).toEqual([]);
    expect(plan.drafts[0]).toMatchObject({
      discountRatePoints: 1,
      effectiveRate: 3,
      royalty: 3,
      marketing: 1,
      total: 4.72,
    });
  });

  it("treats numeric strings and reordered JSON keys as semantically equal", () => {
    const plan = buildRoyaltyBillingPlan({
      rows: [revenueRow({ receipts: 118, tips: 0 })],
      franchisees: [franchisee()],
      existingBillings: [
        storedBilling({
          status: "approved",
          tiersSnapshot: [{ rate: 4, upTo: null }],
        }),
      ],
      sourceFileId: "file-2",
      vat: 0.18,
      period: PERIOD,
    });

    expect(plan.drafts).toEqual([]);
    expect(plan.approvedDifferences).toEqual([]);
  });

  it("reports a corrected-file difference without reopening approved billing", () => {
    const plan = buildRoyaltyBillingPlan({
      rows: [revenueRow({ receipts: 236, tips: 0 })],
      franchisees: [franchisee()],
      existingBillings: [storedBilling({ status: "approved" })],
      sourceFileId: "file-2",
      vat: 0.18,
      period: PERIOD,
    });

    expect(plan.drafts).toEqual([]);
    expect(plan.approvedDifferences).toMatchObject([
      {
        franchiseeId: "franchisee-1",
        status: "approved",
      },
    ]);
    expect(plan.approvedDifferences[0]?.differences.length).toBeGreaterThan(0);
  });
});

describe("sourceReviewProcessingStatus", () => {
  it("marks a clean system review as auto-approved", () => {
    expect(sourceReviewProcessingStatus({
      anomalies: [],
      approvedDifferences: [],
      warnings: [],
      draftsWritten: 1,
    })).toBe("auto_approved");
  });
});

describe("createDraftBillingUpsertQuery", () => {
  it("writes every precomputed value without a second arithmetic path", () => {
    const database = drizzle.mock({ schema });
    const query = createDraftBillingUpsertQuery(
      database,
      draftCandidate(),
    ).toSQL();
    const conflictSql = query.sql.slice(query.sql.indexOf("on conflict"));

    // Keep this exact: arithmetic here would recreate the precision split
    // between JavaScript uploads and PostgreSQL conflict updates.
    expect(conflictSql).toBe([
      'on conflict ("franchisee_id","period_year","period_month") do update',
      'set "receipts" = excluded.receipts, "tips" = excluded.tips,',
      '"include_tips" = excluded.include_tips,',
      '"gross_base" = excluded.gross_base, "net_base" = excluded.net_base,',
      '"tier_rate" = excluded.tier_rate,',
      '"effective_rate" = excluded.effective_rate,',
      '"royalty_full" = excluded.royalty_full,',
      '"royalty" = excluded.royalty,',
      '"discount_value" = excluded.discount_value,',
      '"marketing" = excluded.marketing,',
      '"subtotal" = excluded.subtotal, "total" = excluded.total,',
      '"source_file_id" = excluded.source_file_id',
      'where "franchisee_billing"."status" = $20',
    ].join(" "));
    expect(query.params.at(-1)).toBe("draft");
  });
});

function storedBilling(
  overrides: Partial<StoredFranchiseeBilling> = {},
): StoredFranchiseeBilling {
  return {
    franchiseeId: "franchisee-1",
    periodYear: 2026,
    periodMonth: 6,
    receipts: "118.000000",
    tips: "0.000000",
    includeTips: false,
    grossBase: "118.000000",
    netBase: "100.000000",
    tierRate: "4.00",
    discountRatePoints: "0.00",
    effectiveRate: "4.00",
    royaltyFull: "4.000000",
    royalty: "4.000000",
    discountValue: "0.000000",
    marketing: "1.000000",
    subtotal: "5.000000",
    total: "5.900000",
    tiersSnapshot: [{ upTo: null, rate: 4 }],
    tierBasisSnapshot: "gross",
    marketingRateSnapshot: "1.00",
    vatRateSnapshot: "0.1800",
    status: "draft",
    ...overrides,
  };
}

function draftCandidate(): DraftBillingCandidate {
  return {
    franchiseeId: "franchisee-1",
    periodYear: 2026,
    periodMonth: 6,
    receipts: 118,
    tips: 0,
    includeTips: false,
    grossBase: 118,
    netBase: 100,
    tierRate: 4,
    discountRatePoints: 0,
    effectiveRate: 4,
    royaltyFull: 4,
    royalty: 4,
    discountValue: 0,
    marketing: 1,
    subtotal: 5,
    total: 5.9,
    sourceFileId: "file-1",
    vat: 0.18,
    tiers: [{ upTo: null, rate: 4 }],
    tierBasis: "gross",
    marketingRate: 1,
  };
}
