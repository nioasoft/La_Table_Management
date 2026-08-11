import type { Franchisee, FranchiseeBillingStatus } from "@/db/schema";
import * as schema from "@/db/schema";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { RoyaltyTier, RoyaltyTierBasis } from "@/lib/royalty";
import { calculateRoyalty } from "@/lib/royalty";
import type { RoyaltyRevenuePeriod, RoyaltyRevenueRow } from "@/lib/client-parsers/royalty-revenue-parser";
import { matchFranchiseeName } from "@/lib/franchisee-matcher";

export type BillingFranchisee = Franchisee;

export interface StoredFranchiseeBilling {
  readonly franchiseeId: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly receipts: string;
  readonly tips: string;
  readonly includeTips: boolean;
  readonly grossBase: string;
  readonly netBase: string;
  readonly tierRate: string;
  readonly status: FranchiseeBillingStatus;
  readonly discountRatePoints: string;
  readonly effectiveRate: string;
  readonly royaltyFull: string;
  readonly royalty: string;
  readonly discountValue: string;
  readonly marketing: string;
  readonly subtotal: string;
  readonly total: string;
  readonly tiersSnapshot: readonly RoyaltyTier[] | null;
  readonly tierBasisSnapshot: RoyaltyTierBasis | null;
  readonly marketingRateSnapshot: string | null;
  readonly vatRateSnapshot: string | null;
}

export type BillingAnomalyCode =
  | "unmatched_branch"
  | "inactive_franchisee"
  | "unconfirmed_tiers"
  | "duplicate_franchisee"
  | "negative_base"
  | "missing_branch_name"
  | "missing_amount"
  | "missing_billing_config";

export interface BillingAnomaly {
  readonly code: BillingAnomalyCode;
  readonly rowIndex: number;
  readonly branchName: string;
  readonly franchiseeId?: string;
  readonly message: string;
}

export interface DraftBillingCandidate {
  readonly franchiseeId: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly receipts: number;
  readonly tips: number;
  readonly includeTips: boolean;
  readonly grossBase: number;
  readonly netBase: number;
  readonly tierRate: number;
  readonly discountRatePoints: number;
  readonly effectiveRate: number;
  readonly royaltyFull: number;
  readonly royalty: number;
  readonly discountValue: number;
  readonly marketing: number;
  readonly subtotal: number;
  readonly total: number;
  readonly sourceFileId: string;
  readonly vat: number;
  readonly tiers: readonly RoyaltyTier[];
  readonly tierBasis: RoyaltyTierBasis;
  readonly marketingRate: number;
}

export interface ApprovedFieldDifference {
  readonly field: string;
  readonly approvedValue: unknown;
  readonly uploadedValue: unknown;
}

export interface ApprovedBillingDifference {
  readonly franchiseeId: string;
  readonly status: "approved";
  readonly differences: readonly ApprovedFieldDifference[];
}

export interface RoyaltyBillingPlan {
  readonly drafts: readonly DraftBillingCandidate[];
  readonly anomalies: readonly BillingAnomaly[];
  readonly approvedDifferences: readonly ApprovedBillingDifference[];
}

export interface BuildRoyaltyBillingPlanInput {
  readonly rows: readonly RoyaltyRevenueRow[];
  readonly franchisees: readonly BillingFranchisee[];
  readonly existingBillings: readonly StoredFranchiseeBilling[];
  readonly sourceFileId: string;
  readonly vat: number;
  readonly period: RoyaltyRevenuePeriod;
}

export interface SourceFileInput {
  readonly buffer: Buffer;
  readonly fileName: string;
  readonly mimeType: string;
  readonly uploadedByEmail: string;
  readonly period: RoyaltyRevenuePeriod;
}

export interface SourceFileReview {
  readonly anomalies: readonly BillingAnomaly[];
  readonly approvedDifferences: readonly ApprovedBillingDifference[];
  readonly warnings: readonly string[];
  readonly draftsWritten: number;
}

export interface DraftUpsertResult {
  readonly writtenCount: number;
  readonly skippedFranchiseeIds: readonly string[];
}

export interface FranchiseeBillingOperations {
  readonly readFranchisees: () => Promise<readonly BillingFranchisee[]>;
  readonly readVatRate: (period: RoyaltyRevenuePeriod) => Promise<number | null>;
  readonly readExistingBillings: (period: RoyaltyRevenuePeriod) => Promise<readonly StoredFranchiseeBilling[]>;
  readonly persistSourceFile: (input: SourceFileInput) => Promise<string>;
  readonly recordSourceReview: (sourceFileId: string, review: SourceFileReview) => Promise<void>;
  readonly upsertDrafts: (drafts: readonly DraftBillingCandidate[]) => Promise<DraftUpsertResult>;
}

interface ResolvedRevenueRow {
  readonly row: RoyaltyRevenueRow;
  readonly rowIndex: number;
  readonly franchisee: BillingFranchisee | null;
  readonly anomalies: readonly BillingAnomaly[];
}

function anomaly(
  code: BillingAnomalyCode,
  row: RoyaltyRevenueRow,
  rowIndex: number,
  message: string,
  franchiseeId?: string,
): BillingAnomaly {
  return {
    code,
    rowIndex,
    branchName: row.branchName,
    ...(franchiseeId ? { franchiseeId } : {}),
    message,
  };
}

function blockedRow(
  row: RoyaltyRevenueRow,
  rowIndex: number,
  finding: BillingAnomaly,
): ResolvedRevenueRow {
  return {
    row,
    rowIndex,
    franchisee: null,
    anomalies: [finding],
  };
}

function matchRevenueRow(
  row: RoyaltyRevenueRow,
  rowIndex: number,
  franchisees: readonly BillingFranchisee[],
): ResolvedRevenueRow {
  if (row.missingBranchName) {
    return blockedRow(
      row,
      rowIndex,
      anomaly(
        "missing_branch_name",
        row,
        rowIndex,
        "נמצאה שורה עם סכום וללא שם סניף",
      ),
    );
  }
  if (row.missingReceipts || row.missingTips) {
    return blockedRow(
      row,
      rowIndex,
      anomaly("missing_amount", row, rowIndex, "חסר סכום תקבולים או טיפים"),
    );
  }

  const result = matchFranchiseeName(
    row.branchName,
    [...franchisees],
    { includeInactive: true },
  );
  const matched = result.requiresReview ? null : result.matchedFranchisee;
  if (!matched) {
    return blockedRow(
      row,
      rowIndex,
      anomaly(
        "unmatched_branch",
        row,
        rowIndex,
        `הסניף "${row.branchName}" לא זוהה בהתאמה ודאית`,
      ),
    );
  }
  return {
    row,
    rowIndex,
    franchisee: matched,
    anomalies: [],
  };
}

function configurationAnomalies(
  resolved: ResolvedRevenueRow,
): BillingAnomaly[] {
  const { franchisee, row, rowIndex } = resolved;
  if (!franchisee) return [];
  return [
    ...(!franchisee.isActive || franchisee.status !== "active"
      ? [anomaly(
          "inactive_franchisee",
          row,
          rowIndex,
          `הסניף "${row.branchName}" משויך לזכיין לא פעיל`,
          franchisee.id,
        )]
      : []),
    ...(!franchisee.royaltyTiers?.length ||
    !franchisee.royaltyTiersConfirmed
      ? [anomaly(
          "unconfirmed_tiers",
          row,
          rowIndex,
          `מדרגות התמלוגים של "${franchisee.name}" חסרות או טרם אושרו`,
          franchisee.id,
        )]
      : []),
    ...(franchisee.marketingFeeRate === null
      ? [anomaly(
        "missing_billing_config",
        row,
        rowIndex,
        `אחוז השיווק של "${franchisee.name}" חסר`,
        franchisee.id,
      )]
      : []),
  ];
}

function amountAnomalies(resolved: ResolvedRevenueRow): BillingAnomaly[] {
  const { franchisee, row, rowIndex } = resolved;
  if (!franchisee || row.receipts === null || row.tips === null) return [];
  // Whatever tips the report carries is the number, ₪0 included: a franchisee
  // billed on tips has them added to the base, one billed without them never
  // does. There is no amount of tips that makes a row worth blocking.
  const grossBase =
    row.receipts + (franchisee.royaltyIncludeTips ? row.tips : 0);
  return grossBase < 0
    ? [anomaly(
        "negative_base",
        row,
        rowIndex,
        `בסיס החיוב של "${franchisee.name}" שלילי`,
        franchisee.id,
      )]
    : [];
}

function validateResolvedRow(resolved: ResolvedRevenueRow): BillingAnomaly[] {
  return [
    ...configurationAnomalies(resolved),
    ...amountAnomalies(resolved),
  ];
}

function addDuplicateAnomaly(
  resolved: ResolvedRevenueRow,
  rows: readonly ResolvedRevenueRow[],
): ResolvedRevenueRow {
  const id = resolved.franchisee?.id;
  if (!id || rows.filter((entry) => entry.franchisee?.id === id).length < 2) {
    return resolved;
  }
  return {
    ...resolved,
    anomalies: [
      ...resolved.anomalies,
      anomaly(
        "duplicate_franchisee",
        resolved.row,
        resolved.rowIndex,
        `יותר משורה אחת בקובץ משויכת לזכיין "${resolved.franchisee?.name}"`,
        id,
      ),
    ],
  };
}

function buildDraft(
  resolved: ResolvedRevenueRow,
  input: BuildRoyaltyBillingPlanInput,
): DraftBillingCandidate | null {
  const { franchisee, row } = resolved;
  if (
    resolved.anomalies.length > 0 ||
    !franchisee?.royaltyTiers ||
    franchisee.marketingFeeRate === null ||
    row.receipts === null ||
    row.tips === null
  ) {
    return null;
  }
  const existing = input.existingBillings.find(
    (billing) => billing.franchiseeId === franchisee.id,
  );
  const discountRatePoints = Number(existing?.discountRatePoints ?? 0);
  const calculation = calculateRoyalty({
    receipts: row.receipts,
    tips: row.tips,
    includeTips: franchisee.royaltyIncludeTips,
    tiers: franchisee.royaltyTiers,
    tierBasis: franchisee.royaltyTierBasis,
    marketingRate: Number(franchisee.marketingFeeRate),
    discountRatePoints,
    vat: input.vat,
  });
  return {
    franchiseeId: franchisee.id,
    periodYear: input.period.year,
    periodMonth: input.period.month,
    receipts: row.receipts,
    tips: row.tips,
    includeTips: franchisee.royaltyIncludeTips,
    ...calculation,
    discountRatePoints,
    sourceFileId: input.sourceFileId,
    vat: input.vat,
    tiers: franchisee.royaltyTiers,
    tierBasis: franchisee.royaltyTierBasis,
    marketingRate: Number(franchisee.marketingFeeRate),
  };
}

const NUMERIC_FIELDS = [
  "receipts",
  "tips",
  "grossBase",
  "netBase",
  "tierRate",
  "discountRatePoints",
  "effectiveRate",
  "royaltyFull",
  "royalty",
  "discountValue",
  "marketing",
  "subtotal",
  "total",
] as const;

function sameNumber(left: string | number | null, right: number): boolean {
  if (left === null) return false;
  return Math.abs(Number(left) - right) < 0.0000005 + Number.EPSILON;
}

function sameTiers(
  left: readonly RoyaltyTier[] | null,
  right: readonly RoyaltyTier[],
): boolean {
  return (
    left !== null &&
    left.length === right.length &&
    left.every(
      (tier, index) =>
        tier.upTo === right[index]?.upTo &&
        tier.rate === right[index]?.rate &&
        // `?? false` — an absent key and an explicit false are the same scale,
        // otherwise every upload would report a phantom tiersSnapshot difference.
        (tier.marginal ?? false) === (right[index]?.marginal ?? false),
    )
  );
}

function compareSemanticConfiguration(
  approved: StoredFranchiseeBilling,
  draft: DraftBillingCandidate,
  franchisee: BillingFranchisee,
): ApprovedFieldDifference[] {
  return [
    ...(approved.includeTips === draft.includeTips
      ? []
      : [{
          field: "includeTips",
          approvedValue: approved.includeTips,
          uploadedValue: draft.includeTips,
        }]),
    ...(sameTiers(approved.tiersSnapshot, franchisee.royaltyTiers ?? [])
      ? []
      : [{
          field: "tiersSnapshot",
          approvedValue: approved.tiersSnapshot,
          uploadedValue: franchisee.royaltyTiers,
        }]),
    ...(approved.tierBasisSnapshot === franchisee.royaltyTierBasis
      ? []
      : [{
          field: "tierBasisSnapshot",
          approvedValue: approved.tierBasisSnapshot,
          uploadedValue: franchisee.royaltyTierBasis,
        }]),
    ...(sameNumber(
      approved.marketingRateSnapshot,
      Number(franchisee.marketingFeeRate),
    )
      ? []
      : [{
          field: "marketingRateSnapshot",
          approvedValue: approved.marketingRateSnapshot,
          uploadedValue: Number(franchisee.marketingFeeRate),
        }]),
    ...(sameNumber(approved.vatRateSnapshot, draft.vat)
      ? []
      : [{
          field: "vatRateSnapshot",
          approvedValue: approved.vatRateSnapshot,
          uploadedValue: draft.vat,
        }]),
  ];
}

function compareApproved(
  approved: StoredFranchiseeBilling,
  draft: DraftBillingCandidate,
  franchisee: BillingFranchisee,
): ApprovedFieldDifference[] {
  const numeric = NUMERIC_FIELDS.flatMap((field) =>
    sameNumber(approved[field], draft[field])
      ? []
      : [{
          field,
          approvedValue: approved[field],
          uploadedValue: draft[field],
        }],
  );
  return [
    ...numeric,
    ...compareSemanticConfiguration(approved, draft, franchisee),
  ];
}

export function buildRoyaltyBillingPlan(
  input: BuildRoyaltyBillingPlanInput,
): RoyaltyBillingPlan {
  const matched = input.rows.map((row, rowIndex) =>
    matchRevenueRow(row, rowIndex, input.franchisees),
  );
  const resolved = matched.map((entry) =>
    addDuplicateAnomaly(
      {
        ...entry,
        anomalies: [...entry.anomalies, ...validateResolvedRow(entry)],
      },
      matched,
    ),
  );
  const candidates = resolved.flatMap((entry) => {
    const draft = buildDraft(entry, input);
    return draft ? [{ entry, draft }] : [];
  });
  const approvedDifferences = candidates.flatMap(({ entry, draft }) => {
    const existing = input.existingBillings.find(
      (billing) => billing.franchiseeId === draft.franchiseeId,
    );
    if (existing?.status !== "approved" || !entry.franchisee) return [];
    const differences = compareApproved(existing, draft, entry.franchisee);
    return differences.length === 0
      ? []
      : [{
          franchiseeId: draft.franchiseeId,
          status: "approved" as const,
          differences,
        }];
  });
  const drafts = candidates.flatMap(({ draft }) => {
    const existing = input.existingBillings.find(
      (billing) => billing.franchiseeId === draft.franchiseeId,
    );
    return existing?.status === "approved" ? [] : [draft];
  });
  return {
    drafts,
    anomalies: resolved.flatMap((entry) => entry.anomalies),
    approvedDifferences,
  };
}

function formatPeriodDate(year: number, month: number, day: number): string {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

async function loadBillingRuntime() {
  return Promise.all([
    import("@/db"),
    import("@/lib/storage"),
  ]);
}

type BillingRuntime = Awaited<ReturnType<typeof loadBillingRuntime>>;
type BillingDatabase = BillingRuntime[0]["database"];
type UploadDocument = BillingRuntime[1]["uploadDocument"];
type BillingInsertDatabase = Pick<NodePgDatabase<typeof schema>, "insert">;
type BillingUpsertDatabase = Pick<NodePgDatabase<typeof schema>, "insert" | "select">;

function excludedColumn(column: { readonly name: string }) {
  return sql.raw(`excluded.${column.name}`);
}

function draftInsertValues(
  draft: DraftBillingCandidate,
): typeof schema.franchiseeBilling.$inferInsert {
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
    discountRatePoints: String(draft.discountRatePoints),
    effectiveRate: String(draft.effectiveRate),
    royaltyFull: String(draft.royaltyFull),
    royalty: String(draft.royalty),
    discountValue: String(draft.discountValue),
    marketing: String(draft.marketing),
    subtotal: String(draft.subtotal),
    total: String(draft.total),
    sourceFileId: draft.sourceFileId,
  };
}

export function createDraftBillingUpsertQuery(
  database: BillingInsertDatabase,
  draft: DraftBillingCandidate,
) {
  const { franchiseeBilling } = schema;
  const excluded = (column: { readonly name: string }) =>
    excludedColumn(column);
  return database
    .insert(franchiseeBilling)
    .values(draftInsertValues(draft))
    .onConflictDoUpdate({
      target: [
        franchiseeBilling.franchiseeId,
        franchiseeBilling.periodYear,
        franchiseeBilling.periodMonth,
      ],
      set: {
        receipts: excluded(franchiseeBilling.receipts),
        tips: excluded(franchiseeBilling.tips),
        includeTips: excluded(franchiseeBilling.includeTips),
        grossBase: excluded(franchiseeBilling.grossBase),
        netBase: excluded(franchiseeBilling.netBase),
        tierRate: excluded(franchiseeBilling.tierRate),
        effectiveRate: excluded(franchiseeBilling.effectiveRate),
        royaltyFull: excluded(franchiseeBilling.royaltyFull),
        royalty: excluded(franchiseeBilling.royalty),
        discountValue: excluded(franchiseeBilling.discountValue),
        marketing: excluded(franchiseeBilling.marketing),
        subtotal: excluded(franchiseeBilling.subtotal),
        total: excluded(franchiseeBilling.total),
        sourceFileId: excluded(franchiseeBilling.sourceFileId),
      },
      setWhere: eq(franchiseeBilling.status, "draft"),
    });
}

async function readLockedDiscountRatePoints(tx: BillingUpsertDatabase, draft: DraftBillingCandidate): Promise<number> {
  const { franchiseeBilling } = schema;
  const [stored] = await tx
    .select({ discountRatePoints: franchiseeBilling.discountRatePoints })
    .from(franchiseeBilling)
    .where(and(
      eq(franchiseeBilling.franchiseeId, draft.franchiseeId),
      eq(franchiseeBilling.periodYear, draft.periodYear),
      eq(franchiseeBilling.periodMonth, draft.periodMonth),
    ))
    .for("update")
    .limit(1);
  return Number(stored?.discountRatePoints ?? 0);
}

function recalculateDraft(draft: DraftBillingCandidate, discountRatePoints: number): DraftBillingCandidate {
  const { receipts, tips, includeTips, tiers, tierBasis } = draft;
  const { marketingRate, vat } = draft;
  return {
    ...draft,
    ...calculateRoyalty({
      receipts, tips, includeTips, tiers, tierBasis,
      marketingRate, discountRatePoints, vat,
    }),
    discountRatePoints,
  };
}

async function upsertDraft(tx: BillingUpsertDatabase, draft: DraftBillingCandidate): Promise<boolean> {
  const discountRatePoints = await readLockedDiscountRatePoints(tx, draft);
  const recalculated = recalculateDraft(draft, discountRatePoints);
  const [result] = await createDraftBillingUpsertQuery(tx, recalculated)
    .returning({ id: schema.franchiseeBilling.id });
  return Boolean(result);
}

async function readFranchisees(
  database: BillingDatabase,
): Promise<readonly BillingFranchisee[]> {
  return database
    .select()
    .from(schema.franchisee)
    .where(eq(schema.franchisee.category, "regular"));
}

async function readVatRate(
  database: BillingDatabase,
  period: RoyaltyRevenuePeriod,
): Promise<number | null> {
  const [rate] = await database
    .select({ rate: schema.vatRate.rate })
    .from(schema.vatRate)
    .where(
      lte(
        schema.vatRate.effectiveFrom,
        formatPeriodDate(period.year, period.month, 1),
      ),
    )
    .orderBy(desc(schema.vatRate.effectiveFrom))
    .limit(1);
  return rate ? Number(rate.rate) : null;
}

async function readExistingBillings(
  database: BillingDatabase,
  period: RoyaltyRevenuePeriod,
): Promise<readonly StoredFranchiseeBilling[]> {
  return database
    .select({
      franchiseeId: schema.franchiseeBilling.franchiseeId,
      periodYear: schema.franchiseeBilling.periodYear,
      periodMonth: schema.franchiseeBilling.periodMonth,
      receipts: schema.franchiseeBilling.receipts,
      tips: schema.franchiseeBilling.tips,
      includeTips: schema.franchiseeBilling.includeTips,
      grossBase: schema.franchiseeBilling.grossBase,
      netBase: schema.franchiseeBilling.netBase,
      tierRate: schema.franchiseeBilling.tierRate,
      discountRatePoints: schema.franchiseeBilling.discountRatePoints,
      effectiveRate: schema.franchiseeBilling.effectiveRate,
      royaltyFull: schema.franchiseeBilling.royaltyFull,
      royalty: schema.franchiseeBilling.royalty,
      discountValue: schema.franchiseeBilling.discountValue,
      marketing: schema.franchiseeBilling.marketing,
      subtotal: schema.franchiseeBilling.subtotal,
      total: schema.franchiseeBilling.total,
      tiersSnapshot: schema.franchiseeBilling.tiersSnapshot,
      tierBasisSnapshot: schema.franchiseeBilling.tierBasisSnapshot,
      marketingRateSnapshot:
        schema.franchiseeBilling.marketingRateSnapshot,
      vatRateSnapshot: schema.franchiseeBilling.vatRateSnapshot,
      status: schema.franchiseeBilling.status,
    })
    .from(schema.franchiseeBilling)
    .where(
      and(
        eq(schema.franchiseeBilling.periodYear, period.year),
        eq(schema.franchiseeBilling.periodMonth, period.month),
      ),
    );
}

async function persistSourceFile(
  database: BillingDatabase,
  uploadDocument: UploadDocument,
  input: SourceFileInput,
): Promise<string> {
  const id = crypto.randomUUID();
  const upload = await uploadDocument(
    input.buffer,
    input.fileName,
    input.mimeType,
    "franchisee-royalty",
    `${input.period.year}-${String(input.period.month).padStart(2, "0")}`,
  );
  const endDay = new Date(
    input.period.year,
    input.period.month,
    0,
  ).getDate();
  await database.insert(schema.uploadedFile).values({
    id,
    uploadLinkId: null,
    fileName: upload.fileName,
    originalFileName: upload.originalFileName,
    fileUrl: upload.url,
    fileSize: upload.fileSize,
    mimeType: upload.mimeType,
    uploadedByEmail: input.uploadedByEmail,
    processingStatus: "processing",
    periodStartDate: formatPeriodDate(input.period.year, input.period.month, 1),
    periodEndDate: formatPeriodDate(
      input.period.year,
      input.period.month,
      endDay,
    ),
    metadata: { documentType: "franchisee_royalty_revenue" },
  });
  return id;
}

function createRuntimeOperations(
  runtime: BillingRuntime,
): FranchiseeBillingOperations {
  const [{ database }, { uploadDocument }] = runtime;
  return {
    readFranchisees: () => readFranchisees(database),
    readVatRate: (period) => readVatRate(database, period),
    readExistingBillings: (period) =>
      readExistingBillings(database, period),
    persistSourceFile: (input) =>
      persistSourceFile(database, uploadDocument, input),
    recordSourceReview: async (sourceFileId, review) => {
      await database
        .update(schema.uploadedFile)
        .set({
          processingStatus: sourceReviewProcessingStatus(review),
          metadata: {
            documentType: "franchisee_royalty_revenue",
            ...review,
          },
        })
        .where(eq(schema.uploadedFile.id, sourceFileId));
    },
    upsertDrafts: async (drafts) =>
      database.transaction(async (tx) => {
        return drafts.reduce<Promise<DraftUpsertResult>>(
          async (pending, draft) => {
            const current = await pending;
            const written = await upsertDraft(tx, draft);
            return written
              ? { ...current, writtenCount: current.writtenCount + 1 }
              : {
                  ...current,
                  skippedFranchiseeIds: [
                    ...current.skippedFranchiseeIds,
                    draft.franchiseeId,
                  ],
                };
          },
          Promise.resolve({ writtenCount: 0, skippedFranchiseeIds: [] }),
        );
      }),
  };
}

export function sourceReviewProcessingStatus(
  review: SourceFileReview,
): "needs_review" | "auto_approved" {
  return review.anomalies.length > 0 ||
    review.approvedDifferences.length > 0
    ? "needs_review"
    : "auto_approved";
}

export async function createFranchiseeBillingOperations(): Promise<FranchiseeBillingOperations> {
  return createRuntimeOperations(await loadBillingRuntime());
}
