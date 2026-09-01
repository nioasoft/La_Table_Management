import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import {
  createLatestSourceReviewsQuery,
  createPeriodRowsQuery,
  createUnlinkedSourcesQuery,
} from "@/data-access/franchisee-billing-screen-queries";
import { calculateRoyalty } from "@/lib/royalty";

import {
  calculateDiscountAmounts,
  discardBillingSourceFile,
  loadFranchiseeBillingScreen,
  resolveApprovedBillingDifference,
  updateBillingDiscount,
  updateBillingNoRevenueReason,
  type BillingDiscountContext,
  type BillingNoRevenueContext,
  type BillingScreenOperations,
  type BillingScreenRow,
  type BillingSourceReviewRecord,
  type DifferenceResolutionContext,
  type DiscardSourceFileResult,
  type PersistDifferenceResolutionInput,
  type PersistDiscountInput,
  type PersistNoRevenueReasonInput,
  type ReopenableBilling,
} from "@/data-access/franchisee-billing-screen";

const PERIOD = { year: 2026, month: 6 } as const;

function screenRow(
  overrides: Partial<BillingScreenRow> = {},
): BillingScreenRow {
  return {
    id: "billing-1",
    franchiseeId: "franchisee-1",
    franchiseeName: "ויני יהוד",
    periodYear: 2026,
    periodMonth: 6,
    grossBase: "118.000000",
    netBase: "100.000000",
    tierRate: "4.00",
    discountRatePoints: "0.00",
    discountValue: "0.000000",
    royalty: "4.000000",
    marketing: "1.000000",
    subtotal: "5.000000",
    total: "5.900000",
    noRevenueReason: null,
    deferralBalance: "12.500000",
    sourceFileId: "source-1",
    sourceFileName: "יוני.xlsx",
    isStaleSource: false,
    isApprovalBlocked: false,
    status: "draft",
    ...overrides,
  };
}

function discountContext(
  overrides: Partial<BillingDiscountContext> = {},
): BillingDiscountContext {
  return {
    id: "billing-1",
    periodYear: 2026,
    periodMonth: 6,
    receipts: "118.000000",
    tips: "0.000000",
    includeTips: false,
    tiers: [{ upTo: null, rate: 4 }],
    tierBasis: "gross",
    marketingRate: "1.00",
    status: "draft",
    ...overrides,
  };
}

function sourceReview(
  overrides: Partial<BillingSourceReviewRecord> = {},
): BillingSourceReviewRecord {
  return {
    id: "source-1",
    fileName: "יוני.xlsx",
    metadata: {
      documentType: "franchisee_royalty_revenue",
      anomalies: [],
      approvedDifferences: [],
      warnings: [],
      draftsWritten: 1,
    },
    ...overrides,
  };
}

const TIERS = [{ upTo: null, rate: 4 }] as const;
const CALCULATION_FIELDS = [
  "grossBase",
  "netBase",
  "tierRate",
  "effectiveRate",
  "royaltyFull",
  "royalty",
  "discountValue",
  "marketing",
  "subtotal",
  "total",
] as const;

function approvedBilling(
  overrides: Partial<ReopenableBilling> = {},
): ReopenableBilling {
  const calculation = calculateRoyalty({
    receipts: 118,
    tips: 0,
    includeTips: false,
    tiers: TIERS,
    tierBasis: "gross",
    marketingRate: 1,
    discountRatePoints: 1,
    vat: 0.18,
  });
  return {
    ...discountContext({ status: "approved" }),
    franchiseeId: "franchisee-1",
    receipts: "118",
    tips: "0",
    includeTips: false,
    discountRatePoints: "1",
    tiersSnapshot: [...TIERS],
    tierBasisSnapshot: "gross",
    marketingRateSnapshot: "1",
    vatRateSnapshot: "0.18",
    royaltyExportedAt: null,
    royaltyExportBatchId: null,
    marketingExportedAt: null,
    marketingExportBatchId: null,
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
    ...overrides,
  };
}

function differenceContext(
  metadata: BillingSourceReviewRecord["metadata"],
  billingOverrides: Partial<ReopenableBilling> = {},
): DifferenceResolutionContext {
  return {
    source: sourceReview({ metadata }),
    billing: approvedBilling(billingOverrides),
  };
}

class MemoryOperations implements BillingScreenOperations {
  rows: BillingScreenRow[] = [screenRow()];
  sourcesByBrand: ReadonlyMap<string, BillingSourceReviewRecord> = new Map([
    ["brand-vini", sourceReview()],
  ]);
  unlinkedSources: readonly BillingSourceReviewRecord[] = [];
  context: BillingDiscountContext | null = discountContext();
  vat = 0.18;
  persistedDiscount: PersistDiscountInput | null = null;
  noRevenueContext: BillingNoRevenueContext | null = {
    id: "billing-1",
    status: "draft",
    royalty: "0",
    marketing: "0",
    total: "0",
  };
  persistedNoRevenueReason: PersistNoRevenueReasonInput | null = null;
  differenceContext: DifferenceResolutionContext | null = null;
  persistedResolution: PersistDifferenceResolutionInput | null = null;
  resolutionResult: "success" | "conflict" | "exported" = "success";
  franchisees = [
    { id: "franchisee-1", name: "ויני יהוד", brandId: "brand-vini" },
  ];
  discardedSourceFileId: string | null = null;
  discardResult: DiscardSourceFileResult = "success";

  async readPeriodSnapshot() {
    return {
      rows: this.rows,
      sourcesByBrand: this.sourcesByBrand,
      unlinkedSources: this.unlinkedSources,
    };
  }

  async readDiscountContext(): Promise<BillingDiscountContext | null> {
    return this.context;
  }

  async readVatRate(): Promise<number | null> {
    return this.vat;
  }

  async persistDiscount(input: PersistDiscountInput): Promise<boolean> {
    this.persistedDiscount = input;
    this.rows = this.rows.map((row) =>
      row.id === input.billingId
        ? {
            ...row,
            discountRatePoints: input.discountRatePoints,
            discountValue: input.discountValue,
            royalty: input.royalty,
            subtotal: input.subtotal,
            total: input.total,
          }
        : row,
    );
    return true;
  }

  async readNoRevenueContext(): Promise<BillingNoRevenueContext | null> {
    return this.noRevenueContext;
  }

  async persistNoRevenueReason(
    input: PersistNoRevenueReasonInput,
  ): Promise<boolean> {
    this.persistedNoRevenueReason = input;
    this.rows = this.rows.map((row) =>
      row.id === input.billingId
        ? { ...row, noRevenueReason: input.noRevenueReason }
        : row,
    );
    return true;
  }

  async readDifferenceContext(): Promise<DifferenceResolutionContext | null> {
    return this.differenceContext;
  }

  async persistDifferenceResolution(
    input: PersistDifferenceResolutionInput,
  ): Promise<"success" | "conflict" | "exported"> {
    this.persistedResolution = input;
    return this.resolutionResult;
  }

  async readBillableFranchisees() {
    return this.franchisees;
  }

  async discardSourceFile(
    sourceFileId: string,
  ): Promise<DiscardSourceFileResult> {
    this.discardedSourceFileId = sourceFileId;
    return this.discardResult;
  }
}

describe("calculateDiscountAmounts", () => {
  it("updates the shekel value and every dependent amount without rounding", () => {
    expect(calculateDiscountAmounts(discountContext(), 0.5, 0.18)).toEqual({
      discountRatePoints: 0.5,
      effectiveRate: 3.5,
      royalty: 3.5,
      discountValue: 0.5,
      subtotal: 4.5,
      total: 5.31,
    });
  });

  it("rejects a deferral larger than the stored tier rate", () => {
    expect(() =>
      calculateDiscountAmounts(discountContext(), 4.01, 0.18),
    ).toThrow("הדחייה לא יכולה להיות גבוהה מתעריף המדרגה");
  });
});

describe("updateBillingNoRevenueReason", () => {
  it("stores a manual free-text reason for a zero draft", async () => {
    const operations = new MemoryOperations();

    await expect(
      updateBillingNoRevenueReason(
        "billing-1",
        "  הסניף היה סגור  ",
        operations,
      ),
    ).resolves.toEqual({
      success: true,
      data: { noRevenueReason: "הסניף היה סגור" },
    });
    expect(operations.persistedNoRevenueReason).toEqual({
      billingId: "billing-1",
      noRevenueReason: "הסניף היה סגור",
    });
  });

  it("rejects a reason when any billing amount is positive", async () => {
    const operations = new MemoryOperations();
    operations.noRevenueContext = {
      id: "billing-1",
      status: "draft",
      royalty: "0",
      marketing: "1.000000",
      total: "1.180000",
    };

    await expect(
      updateBillingNoRevenueReason(
        "billing-1",
        "אין פעילות",
        operations,
      ),
    ).resolves.toMatchObject({
      success: false,
      code: "nonzero",
    });
    expect(operations.persistedNoRevenueReason).toBeNull();
  });

  it("allows clearing an existing reason", async () => {
    const operations = new MemoryOperations();

    await expect(
      updateBillingNoRevenueReason("billing-1", null, operations),
    ).resolves.toEqual({
      success: true,
      data: { noRevenueReason: null },
    });
  });
});

describe("loadFranchiseeBillingScreen", () => {
  it("returns a true no-upload empty state", async () => {
    const operations = new MemoryOperations();
    operations.rows = [];
    operations.sourcesByBrand = new Map();

    await expect(
      loadFranchiseeBillingScreen(PERIOD, operations),
    ).resolves.toEqual({
      period: PERIOD,
      sourceFiles: [],
      rows: [],
      anomalies: [],
      approvedDifferences: [],
      warnings: [],
      franchisees: operations.franchisees,
      hasBlockingIssues: false,
    });
  });

  it("surfaces a file that produced no billing rows at all", async () => {
    const operations = new MemoryOperations();
    operations.rows = [];
    operations.sourcesByBrand = new Map();
    operations.unlinkedSources = [sourceReview({
      id: "source-orphan",
      fileName: "יולי.xlsx",
      metadata: {
        documentType: "franchisee_royalty_revenue",
        anomalies: [{
          code: "unconfirmed_tiers",
          rowIndex: 1,
          branchName: "ויני יהוד",
          franchiseeId: "franchisee-1",
          message: "סולם התמלוגים טרם אושר",
        }],
        approvedDifferences: [],
        warnings: [],
        draftsWritten: 0,
      },
    })];

    const result = await loadFranchiseeBillingScreen(PERIOD, operations);

    expect(result.sourceFiles).toEqual([
      { brandId: null, id: "source-orphan", fileName: "יולי.xlsx" },
    ]);
    expect(result.anomalies).toEqual([{
      code: "unconfirmed_tiers",
      rowIndex: 1,
      branchName: "ויני יהוד",
      franchiseeId: "franchisee-1",
      message: "סולם התמלוגים טרם אושר",
      sourceFileId: "source-orphan",
      sourceFileName: "יולי.xlsx",
    }]);
    expect(result.hasBlockingIssues).toBe(true);
  });

  it("enriches persisted anomalies and approved differences with row names", async () => {
    const operations = new MemoryOperations();
    operations.sourcesByBrand = new Map([["brand-vini", sourceReview({
      metadata: {
        documentType: "franchisee_royalty_revenue",
        anomalies: [{
          code: "negative_base",
          rowIndex: 2,
          branchName: "ויני יהוד",
          franchiseeId: "franchisee-1",
          message: "בסיס החיוב של הסניף שלילי",
        }],
        approvedDifferences: [{
          franchiseeId: "franchisee-1",
          status: "approved",
          differences: [{
            field: "receipts",
            approvedValue: "118.000000",
            uploadedValue: 236,
          }],
        }],
        warnings: ["נמצאה הערת מקור"],
        draftsWritten: 0,
      },
    })]]);

    const result = await loadFranchiseeBillingScreen(PERIOD, operations);

    expect(result.anomalies[0]).toMatchObject({
      code: "negative_base",
      franchiseeName: "ויני יהוד",
    });
    expect(result.approvedDifferences[0]).toMatchObject({
      franchiseeId: "franchisee-1",
      franchiseeName: "ויני יהוד",
      sourceFileId: "source-1",
    });
    expect(result.hasBlockingIssues).toBe(true);
  });

  it("marks a row from the previous file as stale and approval-blocked", async () => {
    const operations = new MemoryOperations();
    operations.sourcesByBrand = new Map([
      ["brand-vini", sourceReview({
        id: "source-2",
        fileName: "ויני-יוני-מתוקן.xlsx",
      })],
      ["brand-mina", sourceReview({
        id: "source-mina",
        fileName: "מינה-יוני.xlsx",
      })],
    ]);
    operations.rows = [
      screenRow({
        id: "billing-live",
        sourceFileId: "source-2",
        sourceFileName: "יוני-מתוקן.xlsx",
      }),
      screenRow({
        id: "billing-stale",
        franchiseeId: "franchisee-2",
        franchiseeName: "ויני נתניה",
        sourceFileId: "source-1",
        sourceFileName: "יוני.xlsx",
        isStaleSource: true,
        isApprovalBlocked: true,
      }),
    ];

    const result = await loadFranchiseeBillingScreen(PERIOD, operations);

    expect(result.rows[1]).toMatchObject({
      id: "billing-stale",
      sourceFileName: "יוני.xlsx",
      isStaleSource: true,
      isApprovalBlocked: true,
    });
    expect(result.hasBlockingIssues).toBe(true);
  });

  it("combines three live brand reviews without marking any row stale", async () => {
    const operations = new MemoryOperations();
    operations.sourcesByBrand = new Map([
      ["brand-vini", sourceReview({ id: "source-vini", fileName: "ויני.xlsx" })],
      ["brand-mina", sourceReview({ id: "source-mina", fileName: "מינה.xlsx" })],
      ["brand-king-kong", sourceReview({
        id: "source-king-kong",
        fileName: "קינג קונג.xlsx",
      })],
    ]);
    operations.rows = [
      screenRow({ sourceFileId: "source-vini" }),
      screenRow({
        id: "billing-2",
        franchiseeId: "franchisee-2",
        franchiseeName: "מינה קריות",
        sourceFileId: "source-mina",
      }),
      screenRow({
        id: "billing-3",
        franchiseeId: "franchisee-3",
        franchiseeName: "קינג עפולה",
        sourceFileId: "source-king-kong",
      }),
    ];

    const result = await loadFranchiseeBillingScreen(PERIOD, operations);

    expect(result.sourceFiles.map(({ fileName }) => fileName)).toEqual([
      "ויני.xlsx",
      "מינה.xlsx",
      "קינג קונג.xlsx",
    ]);
    expect(result.rows.every((row) => !row.isStaleSource)).toBe(true);
    expect(result.hasBlockingIssues).toBe(false);
  });
});

describe("updateBillingDiscount", () => {
  it("persists a draft discount and all recalculated stored amounts", async () => {
    const operations = new MemoryOperations();

    const result = await updateBillingDiscount(
      "billing-1",
      1.5,
      operations,
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        discountRatePoints: 1.5,
        discountValue: 1.5,
        total: 4.13,
      },
    });
    expect(operations.persistedDiscount).toMatchObject({
      billingId: "billing-1",
      discountRatePoints: "1.5",
      discountValue: "1.5",
      total: "4.13",
    });
    const refreshed = await loadFranchiseeBillingScreen(PERIOD, operations);
    expect(refreshed.rows[0]).toMatchObject({
      discountRatePoints: "1.5",
      discountValue: "1.5",
      total: "4.13",
    });
  });

  it("does not edit an approved row", async () => {
    const operations = new MemoryOperations();
    operations.context = discountContext({ status: "approved" });

    await expect(
      updateBillingDiscount("billing-1", 1, operations),
    ).resolves.toEqual({
      success: false,
      code: "approved",
      error: "שורה מאושרת אינה ניתנת לעריכה",
    });
    expect(operations.persistedDiscount).toBeNull();
  });
});

describe("resolveApprovedBillingDifference", () => {
  it("keeps an approved row and removes only its persisted difference", async () => {
    const operations = new MemoryOperations();
    operations.differenceContext = differenceContext({
      documentType: "franchisee_royalty_revenue",
      anomalies: [],
      approvedDifferences: [
        {
          franchiseeId: "franchisee-1",
          status: "approved",
          differences: [{
            field: "receipts",
            approvedValue: "118.000000",
            uploadedValue: 236,
          }],
        },
        {
          franchiseeId: "franchisee-2",
          status: "approved",
          differences: [],
        },
      ],
      warnings: [],
      draftsWritten: 0,
    });

    const result = await resolveApprovedBillingDifference(
      {
        sourceFileId: "source-1",
        franchiseeId: "franchisee-1",
        resolution: "keep",
      },
      operations,
    );

    expect(result.success).toBe(true);
    expect(
      operations.persistedResolution?.updatedMetadata.approvedDifferences,
    ).toHaveLength(1);
    expect(operations.persistedResolution?.expectedMetadata).toEqual(
      operations.differenceContext.source.metadata,
    );
    expect(operations.persistedResolution?.reopenedBilling).toBeUndefined();
  });

  it("reopens using semantic uploaded values instead of string equality", async () => {
    const operations = new MemoryOperations();
    const current = approvedBilling();
    const calculationInput = {
      receipts: 236,
      tips: 0,
      includeTips: false,
      tiers: TIERS,
      tierBasis: "gross" as const,
      marketingRate: 1,
      discountRatePoints: 1,
      vat: 0.18,
    };
    const expected = calculateRoyalty(calculationInput);
    operations.differenceContext = differenceContext({
      documentType: "franchisee_royalty_revenue",
      anomalies: [],
      approvedDifferences: [{
        franchiseeId: "franchisee-1",
        status: "approved",
        differences: [
          {
            field: "receipts",
            approvedValue: current.receipts,
            uploadedValue: calculationInput.receipts,
          },
          ...CALCULATION_FIELDS.map((field) => ({
            field,
            approvedValue: current[field],
            uploadedValue: expected[field],
          })),
        ],
      }],
      warnings: [],
      draftsWritten: 0,
    });

    const result = await resolveApprovedBillingDifference(
      {
        sourceFileId: "source-1",
        franchiseeId: "franchisee-1",
        resolution: "reopen",
      },
      operations,
    );

    expect(result.success).toBe(true);
    // Derive the assertion from the canonical engine so this test cannot
    // bless a financially inconsistent hand-written fixture.
    expect(operations.persistedResolution?.reopenedBilling).toMatchObject({
      receipts: String(calculationInput.receipts),
      grossBase: String(expected.grossBase),
      netBase: String(expected.netBase),
      royaltyFull: String(expected.royaltyFull),
      royalty: String(expected.royalty),
      discountRatePoints: String(calculationInput.discountRatePoints),
      subtotal: String(expected.subtotal),
      total: String(expected.total),
      sourceFileId: "source-1",
    });
  });

  it.each([
    {
      label: "non-numeric value",
      field: "receipts",
      uploadedValue: "לא מספר",
    },
    {
      label: "unknown field",
      field: "unexpectedMoney",
      uploadedValue: 10,
    },
  ])("stops and retains a $label difference", async ({
    field,
    uploadedValue,
  }) => {
    const operations = new MemoryOperations();
    const metadata = {
      documentType: "franchisee_royalty_revenue",
      anomalies: [],
      approvedDifferences: [{
        franchiseeId: "franchisee-1",
        status: "approved" as const,
        differences: [{
          field,
          approvedValue: "118",
          uploadedValue,
        }],
      }],
      warnings: [],
      draftsWritten: 0,
    };
    operations.differenceContext = differenceContext(metadata);

    const result = await resolveApprovedBillingDifference(
      {
        sourceFileId: "source-1",
        franchiseeId: "franchisee-1",
        resolution: "reopen",
      },
      operations,
    );

    expect(result).toEqual({
      success: false,
      code: "invalid_review",
      error: "נתוני הקובץ המעודכן אינם תקינים",
    });
    expect(operations.persistedResolution).toBeNull();
    expect(operations.differenceContext.source.metadata).toEqual(metadata);
  });

  it("blocks reopening after either Hashavshevet export was created", async () => {
    const operations = new MemoryOperations();
    operations.differenceContext = differenceContext(
      {
        documentType: "franchisee_royalty_revenue",
        anomalies: [],
        approvedDifferences: [{
          franchiseeId: "franchisee-1",
          status: "approved",
          differences: [{
            field: "receipts",
            approvedValue: "118",
            uploadedValue: 236,
          }],
        }],
        warnings: [],
        draftsWritten: 0,
      },
      {
        royaltyExportedAt: new Date("2026-07-01T10:00:00Z"),
        royaltyExportBatchId: "export-1",
      },
    );

    const result = await resolveApprovedBillingDifference(
      {
        sourceFileId: "source-1",
        franchiseeId: "franchisee-1",
        resolution: "reopen",
      },
      operations,
    );

    expect(result).toEqual({
      success: false,
      code: "exported",
      error: "לא ניתן לפתוח מחדש חיוב שכבר יוצא לחשבשבת",
    });
    expect(operations.persistedResolution).toBeNull();
  });

  it("reports a concurrent metadata change instead of overwriting it", async () => {
    const operations = new MemoryOperations();
    const metadata = {
      documentType: "franchisee_royalty_revenue",
      anomalies: [],
      approvedDifferences: [{
        franchiseeId: "franchisee-1",
        status: "approved" as const,
        differences: [{
          field: "receipts",
          approvedValue: "118",
          uploadedValue: 236,
        }],
      }],
      warnings: [],
      draftsWritten: 0,
    };
    operations.differenceContext = differenceContext(metadata);
    operations.resolutionResult = "conflict";

    const result = await resolveApprovedBillingDifference(
      {
        sourceFileId: "source-1",
        franchiseeId: "franchisee-1",
        resolution: "keep",
      },
      operations,
    );

    expect(result).toEqual({
      success: false,
      code: "conflict",
      error: "הפער השתנה ולא נשמר. רענני את העמוד ונסי שוב",
    });
    expect(operations.persistedResolution?.expectedMetadata).toEqual(metadata);
  });
});

describe("createPeriodRowsQuery with no uploaded files", () => {
  it("emits valid SQL when the month has no source files at all", () => {
    // `case brand_id else null end` is a Postgres syntax error, so an untouched
    // month used to return 500 instead of an empty screen.
    const { sql: text } = createPeriodRowsQuery(
      drizzle.mock({ schema }),
      { year: 2026, month: 8 },
      new Map(),
    ).toSQL();

    expect(text).not.toContain("case");
    expect(text).toContain('"franchisee_billing"."source_file_id" is distinct from null');
  });
});

describe("discardBillingSourceFile", () => {
  it("cancels the upload so a corrected file can replace it", async () => {
    const operations = new MemoryOperations();

    const result = await discardBillingSourceFile("source-1", operations);

    expect(result).toEqual({ success: true, data: { sourceFileId: "source-1" } });
    expect(operations.discardedSourceFileId).toBe("source-1");
  });

  it("refuses a file whose rows were already approved", async () => {
    const operations = new MemoryOperations();
    operations.discardResult = "approved";

    const result = await discardBillingSourceFile("source-1", operations);

    expect(result).toEqual({
      success: false,
      code: "approved",
      error: "לקובץ יש שורות מאושרות. יש לפתוח אותן מחדש לפני ביטול הקובץ",
    });
  });
});

describe("source queries skip a discarded upload", () => {
  it("filters rejected files out of both the linked and unlinked lookups", () => {
    // A cancelled file keeps its row for the audit trail, so both queries have
    // to exclude it or its frozen anomalies keep blocking the month.
    const period = { year: 2026, month: 8 };
    const linked = createLatestSourceReviewsQuery(
      drizzle.mock({ schema }),
      period,
    ).toSQL().sql;
    const unlinked = createUnlinkedSourcesQuery(
      drizzle.mock({ schema }),
      period,
    ).toSQL().sql;

    const expected =
      `is distinct from 'rejected'::uploaded_file_review_status`;
    expect(linked).toContain(expected);
    expect(unlinked).toContain(expected);
  });
});
