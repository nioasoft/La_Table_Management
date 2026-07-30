import {
  buildRoyaltyBillingPlan,
  createFranchiseeBillingOperations,
  type ApprovedBillingDifference,
  type BillingAnomaly,
  type BuildRoyaltyBillingPlanInput,
  type FranchiseeBillingOperations,
  type RoyaltyBillingPlan,
} from "@/data-access/franchisee-billing";
import {
  parseRoyaltyRevenueFile,
  type RoyaltyRevenueParseResult,
  type RoyaltyRevenuePeriod,
  type RoyaltyRevenueRow,
} from "@/lib/client-parsers/royalty-revenue-parser";

export interface ProcessRoyaltyRevenueUploadInput {
  readonly buffer: Buffer;
  readonly fileName: string;
  readonly mimeType: string;
  readonly uploadedByEmail: string;
}

export interface RoyaltyRevenueProcessorDependencies {
  readonly operations: FranchiseeBillingOperations;
  readonly parseRevenue: (
    buffer: Buffer,
    mimeType: string,
  ) => RoyaltyRevenueParseResult;
}

export interface ProcessRoyaltyRevenueUploadResult {
  readonly success: boolean;
  readonly period: RoyaltyRevenuePeriod | null;
  readonly sourceFileId: string | null;
  readonly draftsWritten: number;
  readonly anomalies: readonly BillingAnomaly[];
  readonly approvedDifferences: readonly ApprovedBillingDifference[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly hasBlockingIssues: boolean;
}

function failedResult(
  errors: readonly string[],
  warnings: readonly string[],
): ProcessRoyaltyRevenueUploadResult {
  return {
    success: false,
    period: null,
    sourceFileId: null,
    draftsWritten: 0,
    anomalies: [],
    approvedDifferences: [],
    errors,
    warnings,
    hasBlockingIssues: true,
  };
}

function resolveSinglePeriod(
  rows: readonly RoyaltyRevenueRow[],
): RoyaltyRevenuePeriod | null {
  const periods = rows.flatMap((row) => (row.period ? [row.period] : []));
  if (periods.length !== rows.length || periods.length === 0) return null;
  const [first] = periods;
  return periods.every(
    (period) =>
      period.year === first.year && period.month === first.month,
  )
    ? first
    : null;
}

async function defaultDependencies(): Promise<RoyaltyRevenueProcessorDependencies> {
  return {
    operations: await createFranchiseeBillingOperations(),
    parseRevenue: parseRoyaltyRevenueFile,
  };
}

type PlanInput = Omit<BuildRoyaltyBillingPlanInput, "existingBillings">;

async function refreshConcurrentApprovals(
  operations: FranchiseeBillingOperations,
  planInput: PlanInput,
  original: RoyaltyBillingPlan,
  skippedFranchiseeIds: readonly string[],
): Promise<RoyaltyBillingPlan> {
  if (skippedFranchiseeIds.length === 0) return original;
  const skipped = new Set(skippedFranchiseeIds);
  const refreshed = buildRoyaltyBillingPlan({
    ...planInput,
    existingBillings: await operations.readExistingBillings(planInput.period),
  });
  return {
    drafts: original.drafts,
    anomalies: [
      ...original.anomalies,
      ...refreshed.anomalies.filter(
        (finding) =>
          finding.franchiseeId && skipped.has(finding.franchiseeId),
      ),
    ],
    approvedDifferences: [
      ...original.approvedDifferences,
      ...refreshed.approvedDifferences.filter((difference) =>
        skipped.has(difference.franchiseeId),
      ),
    ],
  };
}

async function processMonthlyRows(
  input: ProcessRoyaltyRevenueUploadInput,
  dependencies: RoyaltyRevenueProcessorDependencies,
  rows: readonly RoyaltyRevenueRow[],
  warnings: readonly string[],
  period: RoyaltyRevenuePeriod,
): Promise<ProcessRoyaltyRevenueUploadResult> {
  const [franchisees, vat, existingBillings] = await Promise.all([
    dependencies.operations.readFranchisees(),
    dependencies.operations.readVatRate(period),
    dependencies.operations.readExistingBillings(period),
  ]);
  if (vat === null) {
    return failedResult(
      ["לא נמצא שיעור מע״מ תקף לחודש שנבחר"],
      warnings,
    );
  }

  const sourceFileId =
    await dependencies.operations.persistSourceFile({
      ...input,
      period,
    });
  const planInput: PlanInput = {
    rows,
    franchisees,
    sourceFileId,
    vat,
    period,
  };
  const initialPlan = buildRoyaltyBillingPlan({
    ...planInput,
    existingBillings,
  });
  const upsert = await dependencies.operations.upsertDrafts(
    initialPlan.drafts,
  );
  const plan = await refreshConcurrentApprovals(
    dependencies.operations,
    planInput,
    initialPlan,
    upsert.skippedFranchiseeIds,
  );
  const draftsWritten = upsert.writtenCount;
  await dependencies.operations.recordSourceReview(sourceFileId, {
    anomalies: plan.anomalies,
    approvedDifferences: plan.approvedDifferences,
    warnings,
    draftsWritten,
  });
  const hasBlockingIssues =
    plan.anomalies.length > 0 || plan.approvedDifferences.length > 0;

  return {
    success: true,
    period,
    sourceFileId,
    draftsWritten,
    anomalies: plan.anomalies,
    approvedDifferences: plan.approvedDifferences,
    errors: [],
    warnings,
    hasBlockingIssues,
  };
}

/**
 * Processes one monthly Tabit royalty report without sharing Tabit pivot logic.
 */
export async function processRoyaltyRevenueUpload(
  input: ProcessRoyaltyRevenueUploadInput,
  dependencies?: RoyaltyRevenueProcessorDependencies,
): Promise<ProcessRoyaltyRevenueUploadResult> {
  const activeDependencies = dependencies ?? (await defaultDependencies());
  const parsed = activeDependencies.parseRevenue(
    input.buffer,
    input.mimeType,
  );
  if (!parsed.success || !parsed.data) {
    return failedResult(parsed.errors, parsed.warnings);
  }
  const period = resolveSinglePeriod(parsed.data.rows);
  if (!period) {
    return failedResult(
      ["כל שורות הקובץ חייבות להשתייך לאותו חודש"],
      parsed.warnings,
    );
  }
  return processMonthlyRows(
    input,
    activeDependencies,
    parsed.data.rows,
    parsed.warnings,
    period,
  );
}
