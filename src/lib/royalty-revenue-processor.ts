import {
  buildRoyaltyBillingPlan,
  createFranchiseeBillingOperations,
  describeOverwriteConflict,
  type ApprovedBillingDifference,
  type BillingAnomaly,
  type BillingRowOverride,
  type BuildRoyaltyBillingPlanInput,
  type FranchiseeBillingOperations,
  type OverwriteConflict,
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
  /**
   * Set when replaying a workbook already stored. The run then updates that
   * row instead of inserting a second one, so a replay leaves no ghost file
   * behind still reporting the findings the replay just cleared.
   */
  readonly sourceFileId?: string;
  readonly rowOverrides?: readonly BillingRowOverride[];
  /**
   * The admin answered the "this month already has rows" dialog with yes.
   * Without it an upload onto an already-billed month is refused and stores
   * nothing, rather than half-writing itself and leaving the rest behind.
   */
  readonly confirmOverwrite?: boolean;
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
  /** Set when the upload was refused pending an overwrite decision. */
  readonly conflict: OverwriteConflict | null;
}

function failedResult(
  errors: readonly string[],
  warnings: readonly string[],
  conflict: OverwriteConflict | null = null,
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
    conflict,
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
    matchedFranchiseeIds: original.matchedFranchiseeIds,
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
  singleBranch: boolean,
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

  // A replay re-runs a file the month already answers to, so it asks nothing
  // and overwrites nothing it was not already allowed to: an approved row it
  // disagrees with still comes back as a difference to settle on the screen.
  const isReplay = input.sourceFileId !== undefined;
  const sourceFileId = input.sourceFileId ?? crypto.randomUUID();
  const overwriteApproved = !isReplay && input.confirmOverwrite === true;
  const planInput: PlanInput = {
    rows,
    franchisees,
    rowOverrides: input.rowOverrides,
    singleBranch,
    overwriteApproved,
    sourceFileId,
    vat,
    period,
  };
  const initialPlan = buildRoyaltyBillingPlan({
    ...planInput,
    existingBillings,
  });
  if (!isReplay && !input.confirmOverwrite) {
    const conflict = describeOverwriteConflict(
      initialPlan.matchedFranchiseeIds,
      existingBillings,
      franchisees,
    );
    if (conflict) {
      return failedResult(
        ["לחודש זה כבר קיימות שורות חיוב"],
        warnings,
        conflict,
      );
    }
  }
  // An invoiced row is the one thing a confirmed overwrite still cannot touch,
  // so say which ones kept their old figures rather than leaving it to be
  // noticed later in a report.
  const exportedNames = overwriteApproved
    ? describeOverwriteConflict(
        initialPlan.matchedFranchiseeIds,
        existingBillings,
        franchisees,
      )?.exportedNames ?? []
    : [];
  const allWarnings = exportedNames.length
    ? [
        ...warnings,
        `שורות שכבר יוצאו לחשבשבת לא עודכנו מהקובץ החדש: ${exportedNames.join(", ")}`,
      ]
    : warnings;
  if (!isReplay) {
    await dependencies.operations.persistSourceFile({
      ...input,
      id: sourceFileId,
      period,
    });
  }
  const upsert = await dependencies.operations.upsertDrafts(
    initialPlan.drafts,
    overwriteApproved,
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
    warnings: allWarnings,
    draftsWritten,
    ...(input.rowOverrides?.length ? { rowOverrides: input.rowOverrides } : {}),
    ...(singleBranch ? { singleBranch } : {}),
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
    warnings: allWarnings,
    hasBlockingIssues,
    conflict: null,
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
    parsed.data.singleBranch,
  );
}
