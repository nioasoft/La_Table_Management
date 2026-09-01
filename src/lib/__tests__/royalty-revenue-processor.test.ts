import { describe, expect, it } from "vitest";
import type {
  BillingFranchisee,
  DraftBillingCandidate,
  FranchiseeBillingOperations,
  SourceFileInput,
  StoredFranchiseeBilling,
} from "@/data-access/franchisee-billing";
import {
  processRoyaltyRevenueUpload,
  type RoyaltyRevenueProcessorDependencies,
} from "@/lib/royalty-revenue-processor";
import type {
  RoyaltyRevenueParseResult,
  RoyaltyRevenueRow,
} from "@/lib/client-parsers/royalty-revenue-parser";
import { calculateRoyalty } from "@/lib/royalty";
import { validateApprovalCalculation } from "@/lib/franchisee-billing-approval";

const PERIOD = { year: 2026, month: 6 } as const;

function parsedRow(receipts = 118): RoyaltyRevenueRow {
  return {
    branchName: "VINNI יהוד",
    receipts,
    tips: 0,
    period: PERIOD,
    missingBranchName: false,
    missingReceipts: false,
    missingTips: false,
  };
}

function billingFranchisee(): BillingFranchisee {
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
  };
}

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

class MemoryBillingOperations implements FranchiseeBillingOperations {
  readonly billings = new Map<string, StoredFranchiseeBilling>();
  readonly reviews = new Map<
    string,
    {
      readonly approvedDifferences: readonly unknown[];
      readonly rowOverrides?: readonly unknown[];
    }
  >();
  sourceFiles = 0;

  constructor(
    initial: readonly StoredFranchiseeBilling[] = [],
    private readonly approveOnUpsert = false,
  ) {
    initial.forEach((billing) => {
      this.billings.set(billing.franchiseeId, billing);
    });
  }

  async readFranchisees(): Promise<readonly BillingFranchisee[]> {
    return [billingFranchisee()];
  }

  async readVatRate(): Promise<number | null> {
    return 0.18;
  }

  async readExistingBillings(): Promise<readonly StoredFranchiseeBilling[]> {
    return [...this.billings.values()];
  }

  async persistSourceFile(_input: SourceFileInput): Promise<string> {
    this.sourceFiles += 1;
    return `source-file-${this.sourceFiles}`;
  }

  async recordSourceReview(
    sourceFileId: string,
    review: {
      readonly approvedDifferences: readonly unknown[];
      readonly rowOverrides?: readonly unknown[];
    },
  ): Promise<void> {
    this.reviews.set(sourceFileId, review);
  }

  async upsertDrafts(
    drafts: readonly DraftBillingCandidate[],
  ): Promise<{
    readonly writtenCount: number;
    readonly skippedFranchiseeIds: readonly string[];
  }> {
    if (this.approveOnUpsert) {
      drafts.forEach((draft) => {
        const current = this.billings.get(draft.franchiseeId);
        if (current) {
          this.billings.set(draft.franchiseeId, {
            ...current,
            status: "approved",
          });
        }
      });
    }
    const skippedFranchiseeIds = drafts.flatMap((draft) =>
      this.billings.get(draft.franchiseeId)?.status === "approved"
        ? [draft.franchiseeId]
        : [],
    );
    drafts.forEach((draft) => {
      const current = this.billings.get(draft.franchiseeId);
      if (current?.status === "approved") return;
      const discount = current?.discountRatePoints ?? "0";
      this.billings.set(
        draft.franchiseeId,
        draftToStored(draft, discount),
      );
    });
    return {
      writtenCount: drafts.length - skippedFranchiseeIds.length,
      skippedFranchiseeIds,
    };
  }
}

function draftToStored(
  draft: DraftBillingCandidate,
  discountRatePoints: string,
): StoredFranchiseeBilling {
  return {
    franchiseeId: draft.franchiseeId,
    periodYear: draft.periodYear,
    periodMonth: draft.periodMonth,
    receipts: String(draft.receipts),
    tips: String(draft.tips),
    includeTips: draft.includeTips,
    grossBase: String(draft.grossBase),
    netBase: String(draft.netBase),
    tierRate: String(draft.tierRate),
    discountRatePoints,
    effectiveRate: String(draft.effectiveRate),
    royaltyFull: String(draft.royaltyFull),
    royalty: String(draft.royalty),
    discountValue: String(draft.discountValue),
    marketing: String(draft.marketing),
    subtotal: String(draft.subtotal),
    total: String(draft.total),
    tiersSnapshot: null,
    tierBasisSnapshot: null,
    marketingRateSnapshot: null,
    vatRateSnapshot: null,
    status: "draft",
  };
}

function dependencies(
  operations: FranchiseeBillingOperations,
  row: RoyaltyRevenueRow = parsedRow(),
): RoyaltyRevenueProcessorDependencies {
  const parsed: RoyaltyRevenueParseResult = {
    success: true,
    data: { rows: [row], singleBranch: false },
    errors: [],
    warnings: [],
  };
  return {
    operations,
    parseRevenue: () => parsed,
  };
}

const UPLOAD = {
  buffer: Buffer.from("royalty revenue"),
  fileName: "יוני.xlsx",
  mimeType:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  uploadedByEmail: "admin@example.com",
} as const;

async function uploadWithStoredDiscount(): Promise<StoredFranchiseeBilling> {
  const operations = new MemoryBillingOperations();
  const row = parsedRow(100_004);
  await processRoyaltyRevenueUpload(UPLOAD, dependencies(operations, row));
  const uploaded = operations.billings.get("franchisee-1");
  if (!uploaded) throw new Error("Expected the first upload to create a draft");
  operations.billings.set("franchisee-1", {
    ...uploaded,
    discountRatePoints: "1.00",
  });
  await processRoyaltyRevenueUpload(UPLOAD, dependencies(operations, row));
  const stored = operations.billings.get("franchisee-1");
  if (!stored) throw new Error("Expected the repeated upload to keep the draft");
  return stored;
}

describe("processRoyaltyRevenueUpload", () => {
  it("keeps one billing row after uploading the same file twice", async () => {
    const operations = new MemoryBillingOperations();
    const deps = dependencies(operations);

    await processRoyaltyRevenueUpload(UPLOAD, deps);
    await processRoyaltyRevenueUpload(UPLOAD, deps);

    expect(operations.billings).toHaveLength(1);
    expect(operations.billings.get("franchisee-1")?.receipts).toBe("118");
  });

  it("preserves a stored discount and recalculates the draft with it", async () => {
    const operations = new MemoryBillingOperations([
      storedBilling({ discountRatePoints: "1.00" }),
    ]);

    await processRoyaltyRevenueUpload(UPLOAD, dependencies(operations));

    expect(operations.billings.get("franchisee-1")).toMatchObject({
      discountRatePoints: "1.00",
      effectiveRate: "3",
      royalty: "3",
      total: "4.72",
    });
  });

  it("keeps the exact JavaScript calculation after upload, deferral, and re-upload", async () => {
    const stored = await uploadWithStoredDiscount();
    const calculation = calculateRoyalty({
      receipts: 100_004,
      tips: 0,
      includeTips: false,
      tiers: [{ upTo: null, rate: 4 }],
      tierBasis: "gross",
      marketingRate: 1,
      discountRatePoints: 1,
      vat: 0.18,
    });
    expect(stored).toMatchObject({
      discountRatePoints: "1.00",
      grossBase: String(calculation.grossBase),
      netBase: String(calculation.netBase),
      tierRate: String(calculation.tierRate),
      effectiveRate: String(calculation.effectiveRate),
      royaltyFull: String(calculation.royaltyFull),
      royalty: String(calculation.royalty),
      discountValue: String(calculation.discountValue),
      marketing: String(calculation.marketing),
      subtotal: String(calculation.subtotal),
      total: String(calculation.total),
    });
    expect(Number(stored.total).toFixed(6)).toBe("4000.160000");
  });

  it("allows approval after recalculating a repeated upload", async () => {
    const stored = await uploadWithStoredDiscount();

    expect(validateApprovalCalculation(stored, {
      tiers: [{ upTo: null, rate: 4 }],
      tierBasis: "gross",
      marketingRate: 1,
      vat: 0.18,
    })).toMatchObject({ success: true });
  });

  it("does not modify an approved row and returns the corrected-file delta", async () => {
    const approved = storedBilling({ status: "approved" });
    const operations = new MemoryBillingOperations([approved]);

    const result = await processRoyaltyRevenueUpload(
      UPLOAD,
      dependencies(operations, parsedRow(236)),
    );

    expect(operations.billings.get("franchisee-1")).toBe(approved);
    expect(result.approvedDifferences).toHaveLength(1);
    expect(result.draftsWritten).toBe(0);
    expect(
      operations.reviews.get("source-file-1")?.approvedDifferences,
    ).toHaveLength(1);
  });

  it("re-reads a row approved during upsert and reports its corrected-file delta", async () => {
    const operations = new MemoryBillingOperations(
      [storedBilling()],
      true,
    );

    const result = await processRoyaltyRevenueUpload(
      UPLOAD,
      dependencies(operations, parsedRow(236)),
    );

    expect(result.draftsWritten).toBe(0);
    expect(result.approvedDifferences).toHaveLength(1);
    expect(result.hasBlockingIssues).toBe(true);
    expect(
      operations.reviews.get("source-file-1")?.approvedDifferences,
    ).toHaveLength(1);
  });

  it("rejects a parser-level monthly grouping error before any persistence", async () => {
    const operations = new MemoryBillingOperations();
    const deps: RoyaltyRevenueProcessorDependencies = {
      operations,
      parseRevenue: () => ({
        success: false,
        data: { rows: [parsedRow()], singleBranch: false },
        errors: ["הקובץ אינו מקובץ לפי חודש"],
        warnings: [],
      }),
    };

    const result = await processRoyaltyRevenueUpload(UPLOAD, deps);

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(["הקובץ אינו מקובץ לפי חודש"]);
    expect(operations.sourceFiles).toBe(0);
    expect(operations.billings).toHaveLength(0);
  });
  it("replays a stored workbook in place instead of adding a second file", async () => {
    // A replay that inserted a new row left the old one behind, still
    // reporting the findings the replay had just cleared.
    const operations = new MemoryBillingOperations();
    const deps = dependencies(operations);
    const first = await processRoyaltyRevenueUpload(UPLOAD, deps);

    const replay = await processRoyaltyRevenueUpload(
      { ...UPLOAD, sourceFileId: first.sourceFileId ?? "" },
      deps,
    );

    expect(operations.sourceFiles).toBe(1);
    expect(replay.sourceFileId).toBe(first.sourceFileId);
  });

  it("keeps a hand-made row decision on the file it was made for", async () => {
    const operations = new MemoryBillingOperations();
    const nameless: RoyaltyRevenueRow = {
      ...parsedRow(),
      branchName: "",
      missingBranchName: true,
    };
    const deps = dependencies(operations, nameless);

    const blocked = await processRoyaltyRevenueUpload(UPLOAD, deps);
    expect(blocked.anomalies).toMatchObject([{ code: "missing_branch_name" }]);

    const assigned = await processRoyaltyRevenueUpload(
      {
        ...UPLOAD,
        sourceFileId: blocked.sourceFileId ?? "",
        rowOverrides: [{ rowIndex: 0, franchiseeId: "franchisee-1" }],
      },
      deps,
    );

    expect(assigned.anomalies).toEqual([]);
    expect(operations.billings.get("franchisee-1")?.receipts).toBe("118");
    expect(
      operations.reviews.get(assigned.sourceFileId ?? "")?.rowOverrides,
    ).toEqual([{ rowIndex: 0, franchiseeId: "franchisee-1" }]);
  });
});
