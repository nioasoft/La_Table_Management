import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";

import {
  buildRoyaltyBillingPlan,
  createDraftBillingUpsertQuery,
  describeOverwriteConflict,
  type BillingFranchisee,
  type DraftBillingCandidate,
  type StoredFranchiseeBilling,
} from "@/data-access/franchisee-billing";
import * as schema from "@/db/schema";
import type { RoyaltyRevenueRow } from "@/lib/client-parsers/royalty-revenue-parser";

const PERIOD = { year: 2026, month: 8 } as const;

function revenueRow(
  overrides: Partial<RoyaltyRevenueRow> = {},
): RoyaltyRevenueRow {
  return {
    branchName: "קינג קונג כרמיאל",
    receipts: 1_278_535,
    tips: 0,
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
    brandId: "brand-king-kong",
    managementCompanyId: null,
    category: "regular",
    name: "קינג קונג כרמיאל",
    code: "KK-KARMIEL",
    aliases: [],
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
    royaltyTiers: [{ upTo: null, rate: 5 }],
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

function storedBilling(
  overrides: Partial<StoredFranchiseeBilling> = {},
): StoredFranchiseeBilling {
  return {
    franchiseeId: "franchisee-1",
    periodYear: PERIOD.year,
    periodMonth: PERIOD.month,
    receipts: "1278535",
    tips: "0",
    includeTips: false,
    grossBase: "1083504.24",
    netBase: "1083504.24",
    tierRate: "5",
    status: "approved",
    discountRatePoints: "0",
    effectiveRate: "5",
    royaltyFull: "54175.21",
    royalty: "54175.21",
    discountValue: "0",
    marketing: "10835.04",
    subtotal: "65010.25",
    total: "76712.10",
    tiersSnapshot: [{ upTo: null, rate: 5 }],
    tierBasisSnapshot: "gross",
    marketingRateSnapshot: "1.00",
    vatRateSnapshot: "0.18",
    royaltyExportBatchId: null,
    marketingExportBatchId: null,
    ...overrides,
  };
}

const planInput = {
  rows: [revenueRow()],
  franchisees: [franchisee()],
  sourceFileId: "file-new",
  vat: 0.18,
  period: PERIOD,
} as const;

describe("buildRoyaltyBillingPlan overwrite", () => {
  it("reports every franchisee the file resolves to, approved ones included", () => {
    const plan = buildRoyaltyBillingPlan({
      ...planInput,
      existingBillings: [storedBilling()],
    });

    expect(plan.drafts).toEqual([]);
    expect(plan.matchedFranchiseeIds).toEqual(["franchisee-1"]);
  });

  it("rewrites an approved row once the overwrite is confirmed", () => {
    const plan = buildRoyaltyBillingPlan({
      ...planInput,
      existingBillings: [storedBilling()],
      overwriteApproved: true,
    });

    expect(plan.drafts).toMatchObject([{ franchiseeId: "franchisee-1" }]);
    expect(plan.approvedDifferences).toEqual([]);
  });

  it("leaves an exported row approved even when the overwrite is confirmed", () => {
    const plan = buildRoyaltyBillingPlan({
      ...planInput,
      existingBillings: [
        storedBilling({ royaltyExportBatchId: "batch-1" }),
      ],
      overwriteApproved: true,
    });

    expect(plan.drafts).toEqual([]);
  });
});

describe("describeOverwriteConflict", () => {
  it("says nothing when the month has no row for the file's franchisees", () => {
    expect(
      describeOverwriteConflict(["franchisee-1"], [], [franchisee()]),
    ).toBeNull();
  });

  it("names the franchisees already billed, and which are approved", () => {
    const conflict = describeOverwriteConflict(
      ["franchisee-1", "franchisee-2"],
      [
        storedBilling(),
        storedBilling({ franchiseeId: "franchisee-2", status: "draft" }),
      ],
      [
        franchisee(),
        franchisee({ id: "franchisee-2", name: "קינג קונג רעננה" }),
      ],
    );

    expect(conflict).toEqual({
      franchiseeNames: ["קינג קונג כרמיאל", "קינג קונג רעננה"],
      approvedNames: ["קינג קונג כרמיאל"],
      exportedNames: [],
    });
  });

  it("separates rows already exported to Hashavshevet", () => {
    const conflict = describeOverwriteConflict(
      ["franchisee-1"],
      [storedBilling({ marketingExportBatchId: "batch-9" })],
      [franchisee()],
    );

    expect(conflict?.exportedNames).toEqual(["קינג קונג כרמיאל"]);
  });
});

describe("createDraftBillingUpsertQuery", () => {
  const database = drizzle.mock({ schema });
  const draft: DraftBillingCandidate = {
    franchiseeId: "franchisee-1",
    periodYear: PERIOD.year,
    periodMonth: PERIOD.month,
    receipts: 1_278_535,
    tips: 0,
    includeTips: false,
    grossBase: 1_083_504.24,
    netBase: 1_083_504.24,
    tierRate: 5,
    discountRatePoints: 0,
    effectiveRate: 5,
    royaltyFull: 54_175.21,
    royalty: 54_175.21,
    discountValue: 0,
    marketing: 10_835.04,
    subtotal: 65_010.25,
    total: 76_712.1,
    sourceFileId: "file-new",
    vat: 0.18,
    tiers: [{ upTo: null, rate: 5 }],
    tierBasis: "gross",
    marketingRate: 1,
  };

  it("touches only draft rows by default", () => {
    const { sql: text } = createDraftBillingUpsertQuery(
      database,
      draft,
    ).toSQL();

    expect(text).toContain(`"franchisee_billing"."status" = $`);
    expect(text).not.toContain(`"royalty_export_batch_id" is null`);
  });

  it("reopens an approved row when overwriting, but never an exported one", () => {
    const { sql: text } = createDraftBillingUpsertQuery(
      database,
      draft,
      true,
    ).toSQL();

    expect(text).toContain(`"royalty_export_batch_id" is null`);
    expect(text).toContain(`"marketing_export_batch_id" is null`);
    expect(text).toContain(`"approved_at" = null`);
  });

  it("clears a stale-source acknowledgement whenever it rewrites a row", () => {
    const { sql: text } = createDraftBillingUpsertQuery(
      database,
      draft,
    ).toSQL();

    expect(text).toContain("stale_source_acknowledged");
  });
});
