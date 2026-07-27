/**
 * Data Access Layer for Reconciliation V2 Module
 *
 * Handles supplier vs franchisee amount reconciliation.
 * Uses a ₪30 threshold for auto-approval.
 */

import { database } from "@/db";
import {
  reconciliationSession,
  reconciliationComparison,
  reconciliationReviewQueue,
  supplier,
  supplierBrand,
  supplierFileUpload,
  franchisee,
  franchiseeBkmvYear,
  brand,
  uploadedFile,
  user,
  type ReconciliationSession,
  type ReconciliationComparison,
  type ReconciliationReviewQueue,
  type CreateReconciliationSessionData,
  type CreateReconciliationComparisonData,
  type CreateReconciliationReviewQueueData,
  type ReconciliationComparisonStatus,
  type SupplierFileProcessingResult,
  type BkmvProcessingResult,
  type SupplierFileMapping,
} from "@/db/schema";
import { eq, and, desc, sql, count, gte, lte, or, ne, isNotNull, isNull, inArray } from "drizzle-orm";
import { getAmountForPeriod } from "@/lib/bkmvdata-parser";
import { getVatRateForDate, DEFAULT_VAT_RATE } from "@/data-access/vatRates";
import { calculateNetFromGross, roundAmount } from "@/lib/file-processor";
import { getDatabaseError } from "@/lib/drizzle-errors";

// ============================================================================
// CONSTANTS
// ============================================================================

// Threshold for auto-approval (in NIS)
export const RECONCILIATION_THRESHOLD = 30;

// ============================================================================
// TYPES
// ============================================================================

// Extended supplier type with file info for selection
export type SupplierWithFileInfo = {
  id: string;
  name: string;
  code: string;
  fileCount: number;
  lastFileDate: Date | null;
  notes: string | null;
};

// Period info for a supplier
export type SupplierPeriod = {
  periodKey: string; // Format: "YYYY-MM-DD_YYYY-MM-DD"
  periodStartDate: string;
  periodEndDate: string;
  supplierFileId: string; // First/latest file ID (for backward compat)
  supplierFileIds: string[]; // All file IDs for this period (for multi-file suppliers)
  supplierFileName: string;
  uploadedAt: Date;
  hasExistingSession: boolean;
  existingSessionId: string | null;
  existingSessionStatus: string | null;
};

// A (supplier × period) pair that has a supplier file but no active session.
// NOTE: mirrored in src/types/reconciliation-v2.ts — keep the two in sync.
export type SessionlessPeriod = {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  /** null = the file's period dates were never parsed — a session can't be built from it */
  periodStartDate: string | null;
  periodEndDate: string | null;
  supplierFileId: string;
  supplierFileIds: string[];
  supplierFileName: string;
  /** processingStatus of the latest file for the period */
  fileStatus: string;
  uploadedAt: Date;
};

// Session with details
// NOTE: mirrored in src/types/reconciliation-v2.ts — keep the two in sync.
export type ReconciliationSessionWithDetails = ReconciliationSession & {
  supplierName: string;
  supplierCode: string;
  supplierFileName: string;
  /**
   * Set on creation when the supplier has no brand mapping and no history to
   * infer one from, so zero-amount row generation was skipped and branches
   * with no activity are absent. Not persisted — it describes the build.
   */
  brandMappingMissing?: boolean;
};

// Comparison with franchisee info
export type ReconciliationComparisonWithDetails = ReconciliationComparison & {
  franchiseeName: string;
  franchiseeCode: string;
  brandName: string | null;
};

// Review queue item (already has denormalized data)
export type ReconciliationReviewQueueItem = ReconciliationReviewQueue;

// History item for display
export type ReconciliationHistoryItem = {
  id: string;
  sessionId: string;
  supplierId: string;
  supplierName: string;
  franchiseeId: string;
  franchiseeName: string;
  periodStartDate: string;
  periodEndDate: string;
  supplierAmount: string;
  franchiseeAmount: string;
  difference: string;
  status: string;
  reviewedAt: Date | null;
  reviewedByName: string | null;
  reviewNotes: string | null;
};

// ============================================================================
// SUPPLIER SELECTION QUERIES
// ============================================================================

/**
 * Get all suppliers that have uploaded files (for dropdown selection)
 */
export async function getSuppliersWithFiles(): Promise<SupplierWithFileInfo[]> {
  const results = await database
    .select({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      fileCount: sql<number>`COUNT(${supplierFileUpload.id})::int`,
      lastFileDate: sql<Date>`MAX(${supplierFileUpload.createdAt})`,
      notes: supplier.description,
    })
    .from(supplier)
    .innerJoin(supplierFileUpload, eq(supplier.id, supplierFileUpload.supplierId))
    .where(
      and(
        eq(supplier.isActive, true),
        eq(supplier.isHidden, false),
        // Only include files that are not rejected
        ne(supplierFileUpload.processingStatus, "rejected")
      )
    )
    .groupBy(supplier.id, supplier.name, supplier.code, supplier.description)
    .orderBy(supplier.name);

  return results;
}

/** One file row as the period grouping needs it */
export type PeriodGroupInput = {
  id: string;
  periodStartDate: string | null;
  periodEndDate: string | null;
  originalFileName: string;
  createdAt: Date;
};

/** A period built from one or more supplier files, before session lookup */
export type GroupedPeriod = {
  periodKey: string;
  periodStartDate: string;
  periodEndDate: string;
  supplierFileId: string;
  supplierFileIds: string[];
  supplierFileName: string;
  uploadedAt: Date;
};

/**
 * Group a supplier's files into periods, newest period first.
 *
 * Files MUST arrive ordered createdAt DESC — "latest per period" relies on it.
 * Files with no parsed period dates are dropped: they can't key a session.
 * Multi-file suppliers (fileMapping.maxUploadFiles > 1) keep every file of a
 * period so the session can merge them; everyone else keeps only the latest.
 */
export function groupFilesIntoPeriods(
  files: PeriodGroupInput[],
  isMultiFile: boolean
): GroupedPeriod[] {
  const latestByPeriod = new Map<string, PeriodGroupInput>();
  const allFileIdsByPeriod = new Map<string, string[]>();

  for (const file of files) {
    if (!file.periodStartDate || !file.periodEndDate) continue;
    const periodKey = `${file.periodStartDate}_${file.periodEndDate}`;
    // First file we encounter for this period is the latest (due to ORDER BY)
    if (!latestByPeriod.has(periodKey)) {
      latestByPeriod.set(periodKey, file);
    }
    if (isMultiFile) {
      const existingIds = allFileIdsByPeriod.get(periodKey) || [];
      existingIds.push(file.id);
      allFileIdsByPeriod.set(periodKey, existingIds);
    } else if (!allFileIdsByPeriod.has(periodKey)) {
      allFileIdsByPeriod.set(periodKey, [file.id]);
    }
  }

  return Array.from(latestByPeriod.values())
    .sort((a, b) => b.periodStartDate!.localeCompare(a.periodStartDate!))
    .map((file) => {
      const periodKey = `${file.periodStartDate}_${file.periodEndDate}`;
      const fileIds = allFileIdsByPeriod.get(periodKey) || [file.id];

      return {
        periodKey,
        periodStartDate: file.periodStartDate!,
        periodEndDate: file.periodEndDate!,
        supplierFileId: file.id,
        supplierFileIds: fileIds,
        supplierFileName:
          fileIds.length > 1
            ? `${file.originalFileName} (+${fileIds.length - 1})`
            : file.originalFileName,
        uploadedAt: file.createdAt,
      };
    });
}

/**
 * Get available periods for a supplier (periods with uploaded files)
 * Returns only the LATEST file for each unique period
 */
export async function getSupplierPeriods(supplierId: string): Promise<SupplierPeriod[]> {
  // Determine if this is a multi-file supplier (e.g., דגי הקיבוצים)
  const [supplierData] = await database
    .select({ fileMapping: supplier.fileMapping })
    .from(supplier)
    .where(eq(supplier.id, supplierId))
    .limit(1);

  const fileMapping = supplierData?.fileMapping as SupplierFileMapping | null;
  const isMultiFile = (fileMapping?.maxUploadFiles ?? 1) > 1;

  // Get all non-rejected supplier files for this supplier
  const files = await database
    .select({
      id: supplierFileUpload.id,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
      originalFileName: supplierFileUpload.originalFileName,
      createdAt: supplierFileUpload.createdAt,
    })
    .from(supplierFileUpload)
    .where(
      and(
        eq(supplierFileUpload.supplierId, supplierId),
        ne(supplierFileUpload.processingStatus, "rejected")
      )
    )
    .orderBy(desc(supplierFileUpload.createdAt)); // Order by upload date to get latest first

  const periods = groupFilesIntoPeriods(files, isMultiFile);

  // Check which periods already have an ACTIVE (non-archived) session.
  // After Match-All clones a session, the source is archived — we surface only the active run.
  const existingSessions = await database
    .select({
      id: reconciliationSession.id,
      periodStartDate: reconciliationSession.periodStartDate,
      periodEndDate: reconciliationSession.periodEndDate,
      status: reconciliationSession.status,
    })
    .from(reconciliationSession)
    .where(
      and(
        eq(reconciliationSession.supplierId, supplierId),
        isNull(reconciliationSession.archivedAt)
      )
    );

  const sessionMap = new Map(
    existingSessions.map((s) => [
      `${s.periodStartDate}_${s.periodEndDate}`,
      { id: s.id, status: s.status },
    ])
  );

  return periods.map((period) => {
    const existingSession = sessionMap.get(period.periodKey);

    return {
      ...period,
      hasExistingSession: !!existingSession,
      existingSessionId: existingSession?.id || null,
      existingSessionStatus: existingSession?.status || null,
    };
  });
}

/**
 * Every (supplier × period) that has a supplier file but no active session —
 * the inverse of the sessions list. Answers "why didn't I build a session".
 *
 * Three queries, no per-supplier fan-out. Files whose period dates never parsed
 * are returned too, with null dates: they are the most common reason a session
 * was never built, and no session can ever key off them.
 */
export async function getPeriodsWithoutSession(): Promise<SessionlessPeriod[]> {
  const suppliers = await database
    .select({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      fileMapping: supplier.fileMapping,
    })
    .from(supplier)
    .where(and(eq(supplier.isActive, true), eq(supplier.isHidden, false)));

  if (suppliers.length === 0) return [];

  const supplierIds = suppliers.map((s) => s.id);

  const files = await database
    .select({
      id: supplierFileUpload.id,
      supplierId: supplierFileUpload.supplierId,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
      originalFileName: supplierFileUpload.originalFileName,
      processingStatus: supplierFileUpload.processingStatus,
      createdAt: supplierFileUpload.createdAt,
    })
    .from(supplierFileUpload)
    .where(
      and(
        inArray(supplierFileUpload.supplierId, supplierIds),
        ne(supplierFileUpload.processingStatus, "rejected")
      )
    )
    .orderBy(desc(supplierFileUpload.createdAt));

  const sessions = await database
    .select({
      supplierId: reconciliationSession.supplierId,
      periodStartDate: reconciliationSession.periodStartDate,
      periodEndDate: reconciliationSession.periodEndDate,
    })
    .from(reconciliationSession)
    .where(isNull(reconciliationSession.archivedAt));

  const sessionKeys = new Set(
    sessions.map((s) => `${s.supplierId}_${s.periodStartDate}_${s.periodEndDate}`)
  );

  const filesBySupplier = new Map<string, typeof files>();
  for (const file of files) {
    const bucket = filesBySupplier.get(file.supplierId);
    if (bucket) bucket.push(file);
    else filesBySupplier.set(file.supplierId, [file]);
  }

  const results: SessionlessPeriod[] = [];

  for (const s of suppliers) {
    const supplierFiles = filesBySupplier.get(s.id);
    if (!supplierFiles?.length) continue;

    const fileMapping = s.fileMapping as SupplierFileMapping | null;
    const isMultiFile = (fileMapping?.maxUploadFiles ?? 1) > 1;
    const statusByFileId = new Map(supplierFiles.map((f) => [f.id, f.processingStatus]));

    for (const period of groupFilesIntoPeriods(supplierFiles, isMultiFile)) {
      if (sessionKeys.has(`${s.id}_${period.periodStartDate}_${period.periodEndDate}`)) continue;
      results.push({
        supplierId: s.id,
        supplierName: s.name,
        supplierCode: s.code,
        periodStartDate: period.periodStartDate,
        periodEndDate: period.periodEndDate,
        supplierFileId: period.supplierFileId,
        supplierFileIds: period.supplierFileIds,
        supplierFileName: period.supplierFileName,
        fileStatus: statusByFileId.get(period.supplierFileId) ?? "unknown",
        uploadedAt: period.uploadedAt,
      });
    }

    // Undated files never reach groupFilesIntoPeriods — list them individually.
    for (const file of supplierFiles) {
      if (file.periodStartDate && file.periodEndDate) continue;
      results.push({
        supplierId: s.id,
        supplierName: s.name,
        supplierCode: s.code,
        periodStartDate: null,
        periodEndDate: null,
        supplierFileId: file.id,
        supplierFileIds: [file.id],
        supplierFileName: file.originalFileName,
        fileStatus: file.processingStatus,
        uploadedAt: file.createdAt,
      });
    }
  }

  // Newest period first; undated rows sink to the bottom, newest upload first.
  return results.sort((a, b) => {
    if (a.periodStartDate && b.periodStartDate) {
      return (
        b.periodStartDate.localeCompare(a.periodStartDate) ||
        a.supplierName.localeCompare(b.supplierName, "he")
      );
    }
    if (a.periodStartDate) return -1;
    if (b.periodStartDate) return 1;
    return b.uploadedAt.getTime() - a.uploadedAt.getTime();
  });
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Create a new reconciliation session with comparisons.
 * Supports multi-file suppliers: pass supplierFileIds to merge franchiseeMatches from multiple files.
 */
export async function createReconciliationSession(
  supplierId: string,
  supplierFileId: string,
  periodStartDate: string,
  periodEndDate: string,
  createdBy: string,
  supplierFileIds?: string[],
  opts?: { runNumber?: number; parentSessionId?: string }
): Promise<ReconciliationSessionWithDetails | null> {
  // Get supplier info
  const supplierData = await database
    .select({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      vatExempt: supplier.vatExempt,
      isKosher: supplier.isKosher,
    })
    .from(supplier)
    .where(eq(supplier.id, supplierId))
    .limit(1);

  if (!supplierData.length) return null;

  // Fetch supplier's brand associations for compatible franchisee filtering
  const supplierBrandRows = await database
    .select({ brandId: supplierBrand.brandId })
    .from(supplierBrand)
    .where(eq(supplierBrand.supplierId, supplierId));
  const brandIdSet = new Set(supplierBrandRows.map(sb => sb.brandId));

  // Self-healing: augment brandIdSet with brands the supplier has actually
  // served in the past, even if supplier_brand mapping is incomplete. Ensures
  // (supplier, franchisee) pairs with zero current activity still appear as
  // 0/0 rows when both sides are missing.
  const historicalBrandsFromFiles = await database.execute<{ brand_id: string }>(sql`
    SELECT DISTINCT f.brand_id AS brand_id
    FROM ${supplierFileUpload} sfu,
         jsonb_array_elements(sfu.processing_result -> 'franchiseeMatches') AS m
    JOIN ${franchisee} f ON f.id = (m ->> 'matchedFranchiseeId')
    WHERE sfu.supplier_id = ${supplierId}
      AND m ->> 'matchedFranchiseeId' IS NOT NULL
      AND m ->> 'matchedFranchiseeId' != ''
      AND COALESCE(m ->> 'matchType', '') NOT IN ('blacklisted', 'fuzzy', 'none')
  `);
  const historicalBrandsFromBkmv = await database.execute<{ brand_id: string }>(sql`
    SELECT DISTINCT f.brand_id AS brand_id
    FROM ${franchiseeBkmvYear} fby
    JOIN ${franchisee} f ON f.id = fby.franchisee_id
    WHERE fby.supplier_matches @> jsonb_build_array(
      jsonb_build_object('matchedSupplierId', ${supplierId}::text)
    )
  `);
  for (const row of historicalBrandsFromFiles.rows) {
    if (row.brand_id) brandIdSet.add(row.brand_id);
  }
  for (const row of historicalBrandsFromBkmv.rows) {
    if (row.brand_id) brandIdSet.add(row.brand_id);
  }

  // Determine which file IDs to load
  const fileIdsToLoad = (supplierFileIds && supplierFileIds.length > 0)
    ? supplierFileIds
    : [supplierFileId];

  // Get supplier file(s) with processing results
  const supplierFileData = await database
    .select({
      id: supplierFileUpload.id,
      originalFileName: supplierFileUpload.originalFileName,
      processingResult: supplierFileUpload.processingResult,
    })
    .from(supplierFileUpload)
    .where(
      fileIdsToLoad.length === 1
        ? eq(supplierFileUpload.id, fileIdsToLoad[0])
        : inArray(supplierFileUpload.id, fileIdsToLoad)
    );

  if (!supplierFileData.length) return null;

  // Merge franchiseeMatches from all files
  const allFranchiseeMatches: SupplierFileProcessingResult["franchiseeMatches"] = [];
  let primaryFileName = "";

  for (const fileData of supplierFileData) {
    if (!fileData.processingResult) continue;
    const result = fileData.processingResult as SupplierFileProcessingResult;
    if (result.franchiseeMatches) {
      allFranchiseeMatches.push(...result.franchiseeMatches);
    }
    if (!primaryFileName) primaryFileName = fileData.originalFileName;
  }

  if (allFranchiseeMatches.length === 0 && supplierFileData.every(f => !f.processingResult)) return null;

  // Build a merged processingResult with combined franchiseeMatches
  const firstResult = supplierFileData.find(f => f.processingResult)?.processingResult as SupplierFileProcessingResult;
  const processingResult: SupplierFileProcessingResult = {
    ...firstResult,
    franchiseeMatches: allFranchiseeMatches,
  };

  // Get VAT rate for the period (use period start date)
  // BKMV amounts include VAT, so we need to convert to net amounts for comparison
  const periodDate = new Date(periodStartDate);
  const vatRate = await getVatRateForDate(periodDate);

  // Build franchisee amount map from year-based BKMV archive (preferred)
  // Falls back to uploaded_file records per-franchisee if not in year table
  const franchiseeAmounts = new Map<
    string,
    { amount: number; fileId: string | null }
  >();

  // Try year-based table first
  const { getAllFranchiseeAmountsFromYearTable } = await import("@/data-access/franchisee-bkmv-year");
  const yearAmounts = await getAllFranchiseeAmountsFromYearTable(
    supplierId,
    periodStartDate,
    periodEndDate
  );

  // Step 1: Use year table data (preferred source) - apply VAT conversion
  for (const [fId, data] of yearAmounts) {
    const netAmount = supplierData[0].vatExempt
      ? roundAmount(data.amount)
      : roundAmount(calculateNetFromGross(data.amount, vatRate));
    franchiseeAmounts.set(fId, { amount: netAmount, fileId: data.fileId });
  }

  // Step 2: Collect franchisee IDs from supplier file that are NOT in year table
  const supplierFranchiseeIds = new Set<string>();
  for (const match of processingResult.franchiseeMatches) {
    if (match.matchedFranchiseeId && match.matchType !== "blacklisted" && match.matchType !== "fuzzy" && match.matchType !== "none") {
      supplierFranchiseeIds.add(match.matchedFranchiseeId);
    }
  }
  const missingFranchiseeIds = [...supplierFranchiseeIds].filter(id => !franchiseeAmounts.has(id));

  // Step 3: Fallback to uploaded_file records for missing franchisees
  if (missingFranchiseeIds.length > 0) {
    const allFranchiseeFiles = await database
      .select({
        id: uploadedFile.id,
        franchiseeId: uploadedFile.franchiseeId,
        bkmvProcessingResult: uploadedFile.bkmvProcessingResult,
        filePeriodStart: uploadedFile.periodStartDate,
        filePeriodEnd: uploadedFile.periodEndDate,
        createdAt: uploadedFile.createdAt,
      })
      .from(uploadedFile)
      .where(
        and(
          isNotNull(uploadedFile.franchiseeId),
          isNotNull(uploadedFile.bkmvProcessingResult),
          lte(uploadedFile.periodStartDate, periodEndDate),
          gte(uploadedFile.periodEndDate, periodStartDate),
          or(
            eq(uploadedFile.processingStatus, "approved"),
            eq(uploadedFile.processingStatus, "auto_approved")
          )
        )
      );

    const latestFileByFranchisee = new Map<string, typeof allFranchiseeFiles[number]>();
    for (const file of allFranchiseeFiles) {
      if (!file.franchiseeId) continue;
      // Only consider files for franchisees missing from year table
      if (!missingFranchiseeIds.includes(file.franchiseeId)) continue;
      const existing = latestFileByFranchisee.get(file.franchiseeId);
      if (!existing || (file.createdAt && existing.createdAt && file.createdAt > existing.createdAt)) {
        latestFileByFranchisee.set(file.franchiseeId, file);
      }
    }

    for (const file of latestFileByFranchisee.values()) {
      if (!file.franchiseeId || !file.bkmvProcessingResult) continue;
      const bkmvResult = file.bkmvProcessingResult as BkmvProcessingResult;
      if (!bkmvResult.supplierMatches) continue;

      if (bkmvResult.monthlyBreakdown) {
        const periodAmount = getAmountForPeriod(
          bkmvResult.monthlyBreakdown,
          supplierId,
          periodStartDate,
          periodEndDate
        );
        if (periodAmount !== null) {
          const netAmount = supplierData[0].vatExempt
            ? roundAmount(periodAmount)
            : roundAmount(calculateNetFromGross(periodAmount, vatRate));
          franchiseeAmounts.set(file.franchiseeId, { amount: netAmount, fileId: file.id });
          continue;
        }
      }

      if (file.filePeriodStart === periodStartDate && file.filePeriodEnd === periodEndDate) {
        for (const match of bkmvResult.supplierMatches) {
          if (match.matchedSupplierId === supplierId) {
            const netAmount = supplierData[0].vatExempt
              ? roundAmount(match.amount)
              : roundAmount(calculateNetFromGross(match.amount, vatRate));
            franchiseeAmounts.set(file.franchiseeId, { amount: netAmount, fileId: file.id });
          }
        }
      }
    }
  }

  // For vatExempt suppliers with per-item VAT (e.g., ale-ale):
  // The BKMV amounts include VAT on vat_applicable products, but the supplier
  // reports everything as net. Build a map of partial VAT per franchisee
  // (grossAmount - netAmount) to subtract from BKMV amounts.
  const partialVatMap = new Map<string, number>();
  if (supplierData[0].vatExempt) {
    for (const match of processingResult.franchiseeMatches) {
      if (!match.matchedFranchiseeId || match.matchType === "blacklisted" || match.matchType === "fuzzy" || match.matchType === "none") continue;
      const partialVat = match.grossAmount - match.netAmount;
      if (partialVat > 0) {
        const existing = partialVatMap.get(match.matchedFranchiseeId) || 0;
        partialVatMap.set(match.matchedFranchiseeId, existing + partialVat);
      }
    }
  }

  // Deduplicate franchisee matches: aggregate amounts when multiple supplier entries
  // map to the same franchisee (e.g., different aliases for the same restaurant)
  const comparisonMap = new Map<
    string,
    {
      supplierAmount: number;
      franchiseeAmount: number;
      supplierOriginalName: string;
      franchiseeFileId: string | null;
    }
  >();

  for (const match of processingResult.franchiseeMatches) {
    if (!match.matchedFranchiseeId || match.matchType === "blacklisted" || match.matchType === "fuzzy" || match.matchType === "none") continue;

    // For vatExempt suppliers: use netAmount (raw from file, no VAT).
    // For normal suppliers: use netAmount for comparison against BKMV net.
    const supplierAmount = supplierData[0].vatExempt
      ? match.netAmount
      : (match.netAmount || match.grossAmount);
    const franchiseeData = franchiseeAmounts.get(match.matchedFranchiseeId);
    // For vatExempt suppliers: subtract partial VAT (gross - net) from BKMV amount
    // because BKMV includes VAT on vat_applicable products but supplier reports net
    const partialVat = partialVatMap.get(match.matchedFranchiseeId) || 0;
    const franchiseeAmount = (franchiseeData?.amount || 0) - partialVat;

    const existing = comparisonMap.get(match.matchedFranchiseeId);
    if (existing) {
      // Aggregate: add supplier amount to existing entry
      existing.supplierAmount += supplierAmount;
      existing.supplierOriginalName = `${existing.supplierOriginalName}, ${match.originalName}`;
    } else {
      comparisonMap.set(match.matchedFranchiseeId, {
        supplierAmount,
        franchiseeAmount,
        supplierOriginalName: match.originalName,
        franchiseeFileId: franchiseeData?.fileId || null,
      });
    }
  }

  // Pass 1: Always include franchisees with actual BKMV data for this supplier
  // This ensures franchisees who bought from the supplier appear even if
  // the supplier didn't report them (supplierAmount=0, franchiseeAmount=BKMV)
  for (const [fId, bkmvData] of franchiseeAmounts) {
    if (!comparisonMap.has(fId)) {
      comparisonMap.set(fId, {
        supplierAmount: 0,
        franchiseeAmount: bkmvData.amount,
        supplierOriginalName: "",
        franchiseeFileId: bkmvData.fileId,
      });
    }
  }

  // Pass 2: Get all compatible franchisees (by brand + kosher) for zero-amount row generation
  const compatConditions = [
    eq(franchisee.isActive, true),
    eq(franchisee.category, "regular"),
  ];
  if (brandIdSet.size === 0) {
    // No brand associations configured — skip compatible franchisee generation
    // to avoid adding ALL franchisees from all brands as zero-amount rows.
    // Surfaced to the user via brandMappingMissing on the returned session:
    // the session then holds only file-matched rows, and branches with no
    // activity are absent rather than shown as 0/0.
    console.warn(
      `[createReconciliationSession] ${supplierData[0].code}: no brand mapping and no history to infer one — zero-amount rows skipped`
    );
  } else {
    compatConditions.push(inArray(franchisee.brandId, [...brandIdSet]));

    // Non-kosher supplier: only show non-kosher franchisees
    // Kosher supplier: show all franchisees (kosher + non-kosher)
    if (!supplierData[0].isKosher) {
      compatConditions.push(eq(franchisee.isKosher, false));
    }
  }
  const allCompatible = brandIdSet.size === 0 ? [] : await database
    .select({ id: franchisee.id })
    .from(franchisee)
    .where(and(...compatConditions));

  // Add zero-amount rows for compatible franchisees missing from supplier file
  for (const f of allCompatible) {
    if (!comparisonMap.has(f.id)) {
      const bkmvData = franchiseeAmounts.get(f.id);
      comparisonMap.set(f.id, {
        supplierAmount: 0,
        franchiseeAmount: bkmvData?.amount || 0,
        supplierOriginalName: "",
        franchiseeFileId: bkmvData?.fileId || null,
      });
    }
  }

  // Build final comparisons from deduped map and compute stats
  let totalSupplierAmount = 0;
  let totalFranchiseeAmount = 0;
  let matchedCount = 0;
  let needsReviewCount = 0;

  // We'll fill in sessionId inside the transaction
  const comparisonEntries: Array<{
    franchiseeId: string;
    supplierAmount: number;
    franchiseeAmount: number;
    difference: number;
    absoluteDifference: number;
    supplierOriginalName: string;
    franchiseeFileId: string | null;
    status: ReconciliationComparisonStatus;
  }> = [];

  for (const [franchiseeId, data] of comparisonMap) {
    const difference = data.supplierAmount - data.franchiseeAmount;
    const absoluteDifference = Math.abs(difference);

    let status: ReconciliationComparisonStatus;
    if (absoluteDifference <= RECONCILIATION_THRESHOLD) {
      status = "auto_approved";
      matchedCount++;
    } else {
      status = "needs_review";
      needsReviewCount++;
    }

    comparisonEntries.push({
      franchiseeId,
      supplierAmount: data.supplierAmount,
      franchiseeAmount: data.franchiseeAmount,
      difference,
      absoluteDifference,
      supplierOriginalName: data.supplierOriginalName,
      franchiseeFileId: data.franchiseeFileId,
      status,
    });

    totalSupplierAmount += data.supplierAmount;
    totalFranchiseeAmount += data.franchiseeAmount;
  }

  const totalDifference = totalSupplierAmount - totalFranchiseeAmount;

  // Wrap session + comparisons + stats update in a single transaction
  // to prevent orphaned sessions if comparison insert fails
  let newSession: ReconciliationSession;
  try {
    newSession = await database.transaction(async (tx) => {
      const [session] = await tx
        .insert(reconciliationSession)
        .values({
          supplierId,
          supplierFileId,
          periodStartDate,
          periodEndDate,
          status: "in_progress",
          createdBy,
          // Rebuild path: a fresh run replacing an archived stale session
          // (runNumber+1 avoids the (supplier, period, run_number) unique index).
          ...(opts?.runNumber ? { runNumber: opts.runNumber } : {}),
          ...(opts?.parentSessionId ? { parentSessionId: opts.parentSessionId } : {}),
        })
        .returning();

      if (comparisonEntries.length > 0) {
        const comparisons: CreateReconciliationComparisonData[] = comparisonEntries.map((entry) => ({
          sessionId: session.id,
          franchiseeId: entry.franchiseeId,
          supplierAmount: entry.supplierAmount.toString(),
          franchiseeAmount: entry.franchiseeAmount.toString(),
          difference: entry.difference.toString(),
          absoluteDifference: entry.absoluteDifference.toString(),
          supplierOriginalName: entry.supplierOriginalName,
          franchiseeFileId: entry.franchiseeFileId,
          status: entry.status,
        }));

        await tx.insert(reconciliationComparison).values(comparisons);
      }

      await tx
        .update(reconciliationSession)
        .set({
          totalFranchisees: comparisonEntries.length,
          matchedCount,
          needsReviewCount,
          approvedCount: matchedCount, // Auto-approved counts as approved
          totalSupplierAmount: totalSupplierAmount.toString(),
          totalFranchiseeAmount: totalFranchiseeAmount.toString(),
          totalDifference: totalDifference.toString(),
          updatedAt: new Date(),
        })
        .where(eq(reconciliationSession.id, session.id));

      return session;
    });
  } catch (error) {
    const dbError = getDatabaseError(error);
    console.error("[createReconciliationSession] Transaction failed:", {
      supplierId,
      supplierFileId,
      periodStartDate,
      periodEndDate,
      pgCode: dbError.code,
      pgConstraint: dbError.constraint,
      pgDetail: dbError.detail,
      pgMessage: dbError.message,
    });
    throw error;
  }

  const displayFileName = fileIdsToLoad.length > 1
    ? `${primaryFileName} (+${fileIdsToLoad.length - 1} קבצים)`
    : primaryFileName;

  return {
    ...newSession,
    totalFranchisees: comparisonEntries.length,
    matchedCount,
    needsReviewCount,
    approvedCount: matchedCount,
    totalSupplierAmount: totalSupplierAmount.toString(),
    totalFranchiseeAmount: totalFranchiseeAmount.toString(),
    totalDifference: totalDifference.toString(),
    supplierName: supplierData[0].name,
    supplierCode: supplierData[0].code,
    supplierFileName: displayFileName,
    brandMappingMissing: brandIdSet.size === 0,
  };
}

/**
 * Rebuild a reconciliation session from the CURRENT data for its period:
 * picks up the latest supplier file(s) and the latest BKMV year amounts,
 * archives the stale source session, and creates a fresh run (runNumber+1).
 *
 * Unlike cloneSessionAndMatchAll (which copies the source's stored amounts),
 * this recomputes BOTH the supplier and franchisee sides from scratch — use it
 * when a newer supplier file or BKMV upload landed after the session was built
 * (the `stale_at` case).
 */
export async function rebuildReconciliationSession(
  sourceSessionId: string,
  userId: string
): Promise<ReconciliationSessionWithDetails | null> {
  const [source] = await database
    .select()
    .from(reconciliationSession)
    .where(eq(reconciliationSession.id, sourceSessionId))
    .limit(1);

  if (!source) throw new Error(`Source session ${sourceSessionId} not found`);
  if (source.archivedAt) throw new Error("Cannot rebuild an archived session");

  // Resolve the latest supplier file(s) for this exact period — handles
  // multi-file suppliers and picks up any upload newer than the source's.
  const periods = await getSupplierPeriods(source.supplierId);
  const match = periods.find(
    (p) =>
      p.periodStartDate === source.periodStartDate &&
      p.periodEndDate === source.periodEndDate
  );
  const fileIds =
    match?.supplierFileIds ?? (source.supplierFileId ? [source.supplierFileId] : []);
  const primaryFileId = match?.supplierFileId ?? source.supplierFileId;
  if (!primaryFileId) {
    throw new Error("No supplier file available to rebuild this period");
  }

  // Build the fresh run first (runNumber+1 → no clash with the still-active
  // source on the (supplier, period, run_number) unique index), then archive
  // the source so a failure leaves the original session intact.
  const newSession = await createReconciliationSession(
    source.supplierId,
    primaryFileId,
    source.periodStartDate,
    source.periodEndDate,
    userId,
    fileIds,
    { runNumber: source.runNumber + 1, parentSessionId: source.id }
  );

  if (!newSession) {
    throw new Error("Failed to build rebuilt reconciliation session");
  }

  await database
    .update(reconciliationSession)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(reconciliationSession.id, source.id));

  return newSession;
}

/**
 * Flag active (non-archived, not-yet-stale) reconciliation sessions whose period
 * overlaps [periodStart, periodEnd] for this supplier as stale, so the UI prompts
 * a rebuild. Called when a newer supplier file is saved for the supplier+period.
 * Returns how many sessions were flagged.
 */
export async function markSupplierSessionsStale(
  supplierId: string,
  periodStart: string,
  periodEnd: string
): Promise<number> {
  const updated = await database
    .update(reconciliationSession)
    .set({ staleAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(reconciliationSession.supplierId, supplierId),
        isNull(reconciliationSession.archivedAt),
        isNull(reconciliationSession.staleAt),
        lte(reconciliationSession.periodStartDate, periodEnd),
        gte(reconciliationSession.periodEndDate, periodStart)
      )
    )
    .returning({ id: reconciliationSession.id });
  return updated.length;
}

/**
 * Flag active reconciliation sessions stale because a franchisee's BKMV data
 * changed — limited to sessions whose period overlaps AND that actually contain
 * a comparison row for this franchisee. Called after a BKMV upsert/approve.
 * Returns how many sessions were flagged.
 */
export async function markFranchiseeSessionsStale(
  franchiseeId: string,
  periodStart: string,
  periodEnd: string
): Promise<number> {
  const sessions = await database
    .select({ id: reconciliationSession.id })
    .from(reconciliationSession)
    .innerJoin(
      reconciliationComparison,
      eq(reconciliationComparison.sessionId, reconciliationSession.id)
    )
    .where(
      and(
        isNull(reconciliationSession.archivedAt),
        isNull(reconciliationSession.staleAt),
        eq(reconciliationComparison.franchiseeId, franchiseeId),
        lte(reconciliationSession.periodStartDate, periodEnd),
        gte(reconciliationSession.periodEndDate, periodStart)
      )
    );

  const ids = [...new Set(sessions.map((s) => s.id))];
  if (ids.length === 0) return 0;

  await database
    .update(reconciliationSession)
    .set({ staleAt: new Date(), updatedAt: new Date() })
    .where(inArray(reconciliationSession.id, ids));
  return ids.length;
}

/**
 * Get session by ID with details
 */
export async function getSessionById(
  sessionId: string
): Promise<ReconciliationSessionWithDetails | null> {
  const results = await database
    .select({
      id: reconciliationSession.id,
      supplierId: reconciliationSession.supplierId,
      supplierFileId: reconciliationSession.supplierFileId,
      periodStartDate: reconciliationSession.periodStartDate,
      periodEndDate: reconciliationSession.periodEndDate,
      status: reconciliationSession.status,
      totalFranchisees: reconciliationSession.totalFranchisees,
      matchedCount: reconciliationSession.matchedCount,
      needsReviewCount: reconciliationSession.needsReviewCount,
      approvedCount: reconciliationSession.approvedCount,
      toReviewQueueCount: reconciliationSession.toReviewQueueCount,
      totalSupplierAmount: reconciliationSession.totalSupplierAmount,
      totalFranchiseeAmount: reconciliationSession.totalFranchiseeAmount,
      totalDifference: reconciliationSession.totalDifference,
      fileRejectionReason: reconciliationSession.fileRejectionReason,
      fileApprovedAt: reconciliationSession.fileApprovedAt,
      fileApprovedBy: reconciliationSession.fileApprovedBy,
      runNumber: reconciliationSession.runNumber,
      parentSessionId: reconciliationSession.parentSessionId,
      archivedAt: reconciliationSession.archivedAt,
      staleAt: reconciliationSession.staleAt,
      createdAt: reconciliationSession.createdAt,
      updatedAt: reconciliationSession.updatedAt,
      createdBy: reconciliationSession.createdBy,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      supplierFileName: supplierFileUpload.originalFileName,
    })
    .from(reconciliationSession)
    .innerJoin(supplier, eq(reconciliationSession.supplierId, supplier.id))
    .innerJoin(supplierFileUpload, eq(reconciliationSession.supplierFileId, supplierFileUpload.id))
    .where(eq(reconciliationSession.id, sessionId))
    .limit(1);

  return results.length > 0 ? results[0] : null;
}

/**
 * Get session with all comparisons
 */
export async function getSessionWithComparisons(sessionId: string): Promise<{
  session: ReconciliationSessionWithDetails;
  comparisons: ReconciliationComparisonWithDetails[];
} | null> {
  const session = await getSessionById(sessionId);
  if (!session) return null;

  const comparisons = await database
    .select({
      id: reconciliationComparison.id,
      sessionId: reconciliationComparison.sessionId,
      franchiseeId: reconciliationComparison.franchiseeId,
      supplierAmount: reconciliationComparison.supplierAmount,
      franchiseeAmount: reconciliationComparison.franchiseeAmount,
      difference: reconciliationComparison.difference,
      absoluteDifference: reconciliationComparison.absoluteDifference,
      supplierOriginalName: reconciliationComparison.supplierOriginalName,
      franchiseeFileId: reconciliationComparison.franchiseeFileId,
      status: reconciliationComparison.status,
      reviewedBy: reconciliationComparison.reviewedBy,
      reviewedAt: reconciliationComparison.reviewedAt,
      reviewNotes: reconciliationComparison.reviewNotes,
      notes: reconciliationComparison.notes,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      brandName: brand.nameHe,
    })
    .from(reconciliationComparison)
    .innerJoin(franchisee, eq(reconciliationComparison.franchiseeId, franchisee.id))
    .leftJoin(brand, eq(franchisee.brandId, brand.id))
    .where(eq(reconciliationComparison.sessionId, sessionId))
    .orderBy(desc(reconciliationComparison.absoluteDifference));

  return { session, comparisons };
}

// ============================================================================
// COMPARISON STATUS UPDATES
// ============================================================================

/**
 * Update a single comparison status
 */
export async function updateComparisonStatus(
  comparisonId: string,
  status: ReconciliationComparisonStatus,
  reviewedBy: string,
  notes?: string
): Promise<ReconciliationComparison | null> {
  const [updated] = await database
    .update(reconciliationComparison)
    .set({
      status,
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes: notes || null,
    })
    .where(eq(reconciliationComparison.id, comparisonId))
    .returning();

  if (updated) {
    // Update session statistics
    await recalculateSessionStats(updated.sessionId);
  }

  return updated || null;
}

/**
 * Franchisee-side (net) amounts as they stand RIGHT NOW for a session's
 * supplier + period, keyed by franchiseeId. This is the single source of truth
 * for "what should the franchisee column say" — used both to refresh a live
 * comparison and to check whether a session's stored amounts are still current.
 *
 * Returns null when the supplier no longer exists. A franchisee missing from
 * the map has no current data (callers treat it as 0).
 */
export async function computeFranchiseeAmountsForSession(sess: {
  supplierId: string;
  supplierFileId: string | null;
  periodStartDate: string;
  periodEndDate: string;
}): Promise<Map<string, { amount: number; fileId: string | null }> | null> {
  const supplierData = await database
    .select({ vatExempt: supplier.vatExempt })
    .from(supplier)
    .where(eq(supplier.id, sess.supplierId))
    .limit(1);
  if (supplierData.length === 0) return null;
  const isVatExempt = supplierData[0].vatExempt;

  const vatRate = await getVatRateForDate(new Date(sess.periodStartDate));

  // Pull the franchisees' BKMV totals for this supplier in this period.
  const { getAllFranchiseeAmountsFromYearTable } = await import(
    "@/data-access/franchisee-bkmv-year"
  );
  const yearAmounts = await getAllFranchiseeAmountsFromYearTable(
    sess.supplierId,
    sess.periodStartDate,
    sess.periodEndDate
  );

  // For VAT-exempt suppliers (e.g. ale-ale), BKMV still includes VAT on
  // vat_applicable items but the supplier reports net — subtract the partial
  // VAT contribution that we can derive from the supplier file's match rows.
  const partialVatByFranchisee = new Map<string, number>();
  if (isVatExempt && sess.supplierFileId) {
    const fileRes = await database
      .select({ processingResult: supplierFileUpload.processingResult })
      .from(supplierFileUpload)
      .where(eq(supplierFileUpload.id, sess.supplierFileId))
      .limit(1);
    const result = fileRes[0]?.processingResult as SupplierFileProcessingResult | null;
    for (const match of result?.franchiseeMatches ?? []) {
      if (
        !match.matchedFranchiseeId ||
        match.matchType === "blacklisted" ||
        match.matchType === "fuzzy" ||
        match.matchType === "none"
      ) {
        continue;
      }
      const pv = match.grossAmount - match.netAmount;
      if (pv > 0) {
        partialVatByFranchisee.set(
          match.matchedFranchiseeId,
          (partialVatByFranchisee.get(match.matchedFranchiseeId) ?? 0) + pv
        );
      }
    }
  }

  const franchiseeIds = new Set([
    ...yearAmounts.keys(),
    ...partialVatByFranchisee.keys(),
  ]);

  const result = new Map<string, { amount: number; fileId: string | null }>();
  for (const franchiseeId of franchiseeIds) {
    const bkmv = yearAmounts.get(franchiseeId) ?? { amount: 0, fileId: null };
    // BKMV stores gross. Supplier reports net. Convert per supplier's VAT mode.
    const bkmvNet = isVatExempt
      ? roundAmount(bkmv.amount)
      : roundAmount(calculateNetFromGross(bkmv.amount, vatRate));
    result.set(franchiseeId, {
      amount: bkmvNet - (partialVatByFranchisee.get(franchiseeId) ?? 0),
      fileId: bkmv.fileId,
    });
  }

  return result;
}

/**
 * Refresh a single comparison's franchisee-side amount by re-aggregating the
 * latest BKMV data for that franchisee + period. Supplier-side data is left
 * untouched. Manual statuses are preserved (manually_approved,
 * sent_to_review_queue) — only auto_approved/needs_review get re-evaluated
 * against the threshold. Notes and review trail survive.
 */
export async function refreshFranchiseeAmount(
  comparisonId: string
): Promise<ReconciliationComparison | null> {
  const rows = await database
    .select({
      comparison: reconciliationComparison,
      session: reconciliationSession,
    })
    .from(reconciliationComparison)
    .innerJoin(
      reconciliationSession,
      eq(reconciliationComparison.sessionId, reconciliationSession.id)
    )
    .where(eq(reconciliationComparison.id, comparisonId))
    .limit(1);
  if (rows.length === 0) return null;
  const { comparison: comp, session: sess } = rows[0];

  // Refusing to mutate archived sessions keeps history truthful.
  if (sess.archivedAt) return null;

  const currentAmounts = await computeFranchiseeAmountsForSession(sess);
  if (!currentAmounts) return null;
  const current = currentAmounts.get(comp.franchiseeId) ?? {
    amount: 0,
    fileId: comp.franchiseeFileId,
  };

  const newFranchiseeAmount = current.amount;
  const supplierAmount = Number(comp.supplierAmount);
  const difference = supplierAmount - newFranchiseeAmount;
  const absoluteDifference = Math.abs(difference);

  // Manual decisions stick; only auto rows re-evaluate vs the threshold.
  let newStatus: ReconciliationComparisonStatus = comp.status;
  if (comp.status === "auto_approved" || comp.status === "needs_review") {
    newStatus =
      absoluteDifference <= RECONCILIATION_THRESHOLD
        ? "auto_approved"
        : "needs_review";
  }

  const [updated] = await database
    .update(reconciliationComparison)
    .set({
      franchiseeAmount: newFranchiseeAmount.toString(),
      difference: difference.toString(),
      absoluteDifference: absoluteDifference.toString(),
      franchiseeFileId: current.fileId ?? comp.franchiseeFileId,
      status: newStatus,
    })
    .where(eq(reconciliationComparison.id, comparisonId))
    .returning();

  if (updated && newStatus !== comp.status) {
    await recalculateSessionStats(updated.sessionId);
  }

  return updated ?? null;
}

/**
 * Update comparison free-form notes (separate from review workflow)
 */
export async function updateComparisonNotes(
  comparisonId: string,
  notes: string | null
) {
  const [updated] = await database
    .update(reconciliationComparison)
    .set({ notes })
    .where(eq(reconciliationComparison.id, comparisonId))
    .returning();
  return updated || null;
}

/**
 * Bulk approve comparisons
 */
export async function bulkApproveComparisons(
  comparisonIds: string[],
  reviewedBy: string
): Promise<number> {
  if (comparisonIds.length === 0) return 0;

  const result = await database
    .update(reconciliationComparison)
    .set({
      status: "manually_approved",
      reviewedBy,
      reviewedAt: new Date(),
    })
    .where(
      and(
        inArray(reconciliationComparison.id, comparisonIds),
        eq(reconciliationComparison.status, "needs_review")
      )
    )
    .returning({ sessionId: reconciliationComparison.sessionId });

  // Get unique session IDs and recalculate stats
  const sessionIds = [...new Set(result.map((r) => r.sessionId))];
  for (const sessionId of sessionIds) {
    await recalculateSessionStats(sessionId);
  }

  return result.length;
}

export type MatchAllResult = {
  newSessionId: string;
  matchedCount: number;
  belowThresholdCount: number;
};

/**
 * Match-All: clone the source session into a new run, archive the source,
 * and auto-approve every comparison whose absolute difference ≤ RECONCILIATION_THRESHOLD
 * and is currently in `needs_review`. Atomic.
 *
 * The source session is preserved (archived) so historical state is auditable.
 */
export async function cloneSessionAndMatchAll(
  sourceSessionId: string,
  reviewedBy: string
): Promise<MatchAllResult> {
  return database.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(reconciliationSession)
      .where(eq(reconciliationSession.id, sourceSessionId))
      .limit(1);

    if (!source) {
      throw new Error(`Source session ${sourceSessionId} not found`);
    }

    if (source.archivedAt) {
      throw new Error("Cannot run Match-All on an archived session");
    }

    const sourceComparisons = await tx
      .select()
      .from(reconciliationComparison)
      .where(eq(reconciliationComparison.sessionId, sourceSessionId));

    // Archive the source so it stops appearing as "active" for the period.
    await tx
      .update(reconciliationSession)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(reconciliationSession.id, sourceSessionId));

    // Insert the new session at runNumber + 1, parent points back to source.
    const [newSession] = await tx
      .insert(reconciliationSession)
      .values({
        supplierId: source.supplierId,
        supplierFileId: source.supplierFileId,
        periodStartDate: source.periodStartDate,
        periodEndDate: source.periodEndDate,
        status: "in_progress",
        totalSupplierAmount: source.totalSupplierAmount,
        totalFranchiseeAmount: source.totalFranchiseeAmount,
        totalDifference: source.totalDifference,
        runNumber: source.runNumber + 1,
        parentSessionId: source.id,
        archivedAt: null,
        createdBy: reviewedBy,
      })
      .returning();

    const now = new Date();
    let matchedCount = 0;
    let belowThresholdCount = 0;

    if (sourceComparisons.length > 0) {
      const newRows = sourceComparisons.map((c) => {
        const isNeedsReview = c.status === "needs_review";
        const isBelowThreshold =
          isNeedsReview && Number(c.absoluteDifference) <= RECONCILIATION_THRESHOLD;

        if (isBelowThreshold) {
          matchedCount++;
          belowThresholdCount++;
        }

        return {
          sessionId: newSession.id,
          franchiseeId: c.franchiseeId,
          supplierAmount: c.supplierAmount,
          franchiseeAmount: c.franchiseeAmount,
          difference: c.difference,
          absoluteDifference: c.absoluteDifference,
          supplierOriginalName: c.supplierOriginalName,
          franchiseeFileId: c.franchiseeFileId,
          status: isBelowThreshold ? ("manually_approved" as const) : c.status,
          reviewedBy: isBelowThreshold ? reviewedBy : c.reviewedBy,
          reviewedAt: isBelowThreshold ? now : c.reviewedAt,
          reviewNotes: isBelowThreshold
            ? `Match-All ≤₪${RECONCILIATION_THRESHOLD}`
            : c.reviewNotes,
          notes: c.notes,
        };
      });

      await tx.insert(reconciliationComparison).values(newRows);
    }

    // Recalculate session stats inline (recalculateSessionStats uses the global db, not tx,
    // so we compute here directly to stay inside the transaction).
    let totalFranchisees = 0;
    let newMatchedCount = 0;
    let newNeedsReviewCount = 0;
    let newApprovedCount = 0;
    let newToReviewQueueCount = 0;

    for (const c of sourceComparisons) {
      totalFranchisees++;
      const isNeedsReview = c.status === "needs_review";
      const isBelowThreshold =
        isNeedsReview && Number(c.absoluteDifference) <= RECONCILIATION_THRESHOLD;
      const finalStatus = isBelowThreshold ? "manually_approved" : c.status;

      if (finalStatus === "auto_approved") {
        newMatchedCount++;
        newApprovedCount++;
      } else if (finalStatus === "manually_approved") {
        newApprovedCount++;
      } else if (finalStatus === "needs_review") {
        newNeedsReviewCount++;
      } else if (finalStatus === "sent_to_review_queue") {
        newToReviewQueueCount++;
      }
    }

    const sessionStatus =
      newNeedsReviewCount === 0 && newToReviewQueueCount === 0
        ? "completed"
        : "in_progress";

    await tx
      .update(reconciliationSession)
      .set({
        totalFranchisees,
        matchedCount: newMatchedCount,
        needsReviewCount: newNeedsReviewCount,
        approvedCount: newApprovedCount,
        toReviewQueueCount: newToReviewQueueCount,
        status: sessionStatus,
        updatedAt: new Date(),
      })
      .where(eq(reconciliationSession.id, newSession.id));

    return {
      newSessionId: newSession.id,
      matchedCount,
      belowThresholdCount,
    };
  });
}

/**
 * Find the active (non-archived) session for a (supplier, period) tuple.
 * Returns null if none exists.
 */
export async function getActiveSession(
  supplierId: string,
  periodStartDate: string,
  periodEndDate: string
): Promise<ReconciliationSession | null> {
  const [row] = await database
    .select()
    .from(reconciliationSession)
    .where(
      and(
        eq(reconciliationSession.supplierId, supplierId),
        eq(reconciliationSession.periodStartDate, periodStartDate),
        eq(reconciliationSession.periodEndDate, periodEndDate),
        isNull(reconciliationSession.archivedAt)
      )
    )
    .limit(1);
  return row ?? null;
}

/**
 * Return all runs for a (supplier, period), newest run first.
 * Used for the run-history dropdown in the reconciliation page.
 */
export async function getSessionHistory(
  supplierId: string,
  periodStartDate: string,
  periodEndDate: string
): Promise<ReconciliationSession[]> {
  return database
    .select()
    .from(reconciliationSession)
    .where(
      and(
        eq(reconciliationSession.supplierId, supplierId),
        eq(reconciliationSession.periodStartDate, periodStartDate),
        eq(reconciliationSession.periodEndDate, periodEndDate)
      )
    )
    .orderBy(desc(reconciliationSession.runNumber));
}

/**
 * Add a comparison to the review queue
 */
export async function addToReviewQueue(
  comparisonId: string,
  sessionId: string
): Promise<ReconciliationReviewQueue | null> {
  // Get comparison with details
  const comparison = await database
    .select({
      id: reconciliationComparison.id,
      sessionId: reconciliationComparison.sessionId,
      franchiseeId: reconciliationComparison.franchiseeId,
      supplierAmount: reconciliationComparison.supplierAmount,
      franchiseeAmount: reconciliationComparison.franchiseeAmount,
      difference: reconciliationComparison.difference,
      franchiseeName: franchisee.name,
    })
    .from(reconciliationComparison)
    .innerJoin(franchisee, eq(reconciliationComparison.franchiseeId, franchisee.id))
    .where(eq(reconciliationComparison.id, comparisonId))
    .limit(1);

  if (!comparison.length) return null;

  // Get session info
  const session = await database
    .select({
      supplierId: reconciliationSession.supplierId,
      periodStartDate: reconciliationSession.periodStartDate,
      periodEndDate: reconciliationSession.periodEndDate,
      supplierName: supplier.name,
    })
    .from(reconciliationSession)
    .innerJoin(supplier, eq(reconciliationSession.supplierId, supplier.id))
    .where(eq(reconciliationSession.id, sessionId))
    .limit(1);

  if (!session.length) return null;

  // Update comparison status
  await database
    .update(reconciliationComparison)
    .set({ status: "sent_to_review_queue" })
    .where(eq(reconciliationComparison.id, comparisonId));

  // Create review queue entry
  const [queueItem] = await database
    .insert(reconciliationReviewQueue)
    .values({
      comparisonId,
      sessionId,
      supplierId: session[0].supplierId,
      supplierName: session[0].supplierName,
      franchiseeId: comparison[0].franchiseeId,
      franchiseeName: comparison[0].franchiseeName,
      periodStartDate: session[0].periodStartDate,
      periodEndDate: session[0].periodEndDate,
      supplierAmount: comparison[0].supplierAmount,
      franchiseeAmount: comparison[0].franchiseeAmount,
      difference: comparison[0].difference,
      status: "pending",
    })
    .returning();

  // Update session stats
  await recalculateSessionStats(sessionId);

  return queueItem;
}

// ============================================================================
// REVIEW QUEUE
// ============================================================================

/**
 * Get all pending review queue items
 */
export async function getReviewQueueItems(): Promise<ReconciliationReviewQueueItem[]> {
  return database
    .select()
    .from(reconciliationReviewQueue)
    .where(eq(reconciliationReviewQueue.status, "pending"))
    .orderBy(desc(reconciliationReviewQueue.createdAt));
}

/**
 * Get review queue count (for sidebar badge)
 */
export async function getReviewQueueCount(): Promise<number> {
  const result = await database
    .select({ count: count() })
    .from(reconciliationReviewQueue)
    .where(eq(reconciliationReviewQueue.status, "pending"));

  return result[0]?.count || 0;
}

/**
 * Resolve a review queue item
 */
export async function resolveReviewQueueItem(
  queueItemId: string,
  resolvedBy: string,
  notes?: string
): Promise<ReconciliationReviewQueue | null> {
  // Get the queue item
  const queueItem = await database
    .select()
    .from(reconciliationReviewQueue)
    .where(eq(reconciliationReviewQueue.id, queueItemId))
    .limit(1);

  if (!queueItem.length) return null;

  // Update queue item
  const [updated] = await database
    .update(reconciliationReviewQueue)
    .set({
      status: "resolved",
      resolvedBy,
      resolvedAt: new Date(),
      resolutionNotes: notes || null,
    })
    .where(eq(reconciliationReviewQueue.id, queueItemId))
    .returning();

  // Update the associated comparison
  await database
    .update(reconciliationComparison)
    .set({
      status: "manually_approved",
      reviewedBy: resolvedBy,
      reviewedAt: new Date(),
      reviewNotes: notes || null,
    })
    .where(eq(reconciliationComparison.id, queueItem[0].comparisonId));

  // Update session stats
  await recalculateSessionStats(queueItem[0].sessionId);

  return updated;
}

// ============================================================================
// SESSION STATUS
// ============================================================================

/**
 * Approve the supplier file (mark session as file_approved)
 */
export async function approveSessionFile(
  sessionId: string,
  approvedBy: string
): Promise<ReconciliationSession | null> {
  const [updated] = await database
    .update(reconciliationSession)
    .set({
      status: "file_approved",
      fileApprovedAt: new Date(),
      fileApprovedBy: approvedBy,
      updatedAt: new Date(),
    })
    .where(eq(reconciliationSession.id, sessionId))
    .returning();

  return updated || null;
}

/**
 * Reject the supplier file with reason
 */
export async function rejectSessionFile(
  sessionId: string,
  rejectedBy: string,
  reason: string
): Promise<ReconciliationSession | null> {
  const [updated] = await database
    .update(reconciliationSession)
    .set({
      status: "file_rejected",
      fileRejectionReason: reason,
      fileApprovedBy: rejectedBy, // Reusing field to track who rejected
      fileApprovedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(reconciliationSession.id, sessionId))
    .returning();

  return updated || null;
}

// ============================================================================
// HISTORY
// ============================================================================

/**
 * Get reconciliation history with filters
 */
export async function getReconciliationHistory(filters?: {
  supplierId?: string;
  franchiseeId?: string;
  periodStartDate?: string;
  periodEndDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: ReconciliationHistoryItem[]; total: number }> {
  const conditions = [];

  if (filters?.supplierId) {
    conditions.push(eq(reconciliationSession.supplierId, filters.supplierId));
  }

  if (filters?.franchiseeId) {
    conditions.push(eq(reconciliationComparison.franchiseeId, filters.franchiseeId));
  }

  if (filters?.periodStartDate) {
    conditions.push(gte(reconciliationSession.periodStartDate, filters.periodStartDate));
  }

  if (filters?.periodEndDate) {
    conditions.push(lte(reconciliationSession.periodEndDate, filters.periodEndDate));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const countResult = await database
    .select({ count: count() })
    .from(reconciliationComparison)
    .innerJoin(
      reconciliationSession,
      eq(reconciliationComparison.sessionId, reconciliationSession.id)
    )
    .where(whereClause);

  const total = countResult[0]?.count || 0;

  // Get items
  let query = database
    .select({
      id: reconciliationComparison.id,
      sessionId: reconciliationComparison.sessionId,
      supplierId: reconciliationSession.supplierId,
      supplierName: supplier.name,
      franchiseeId: reconciliationComparison.franchiseeId,
      franchiseeName: franchisee.name,
      periodStartDate: reconciliationSession.periodStartDate,
      periodEndDate: reconciliationSession.periodEndDate,
      supplierAmount: reconciliationComparison.supplierAmount,
      franchiseeAmount: reconciliationComparison.franchiseeAmount,
      difference: reconciliationComparison.difference,
      status: reconciliationComparison.status,
      reviewedAt: reconciliationComparison.reviewedAt,
      reviewedByName: user.name,
      reviewNotes: reconciliationComparison.reviewNotes,
    })
    .from(reconciliationComparison)
    .innerJoin(
      reconciliationSession,
      eq(reconciliationComparison.sessionId, reconciliationSession.id)
    )
    .innerJoin(supplier, eq(reconciliationSession.supplierId, supplier.id))
    .innerJoin(franchisee, eq(reconciliationComparison.franchiseeId, franchisee.id))
    .leftJoin(user, eq(reconciliationComparison.reviewedBy, user.id))
    .where(whereClause)
    // NULLS LAST is load-bearing: Postgres puts NULLs first on DESC, so
    // never-reviewed rows would fill page 1 of the history and push the
    // recently-reviewed ones the screen is for off the end.
    .orderBy(sql`${reconciliationComparison.reviewedAt} DESC NULLS LAST`)
    .$dynamic();

  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  if (filters?.offset) {
    query = query.offset(filters.offset);
  }

  const items = await query;

  return { items, total };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Recalculate session statistics after comparison updates
 */
async function recalculateSessionStats(sessionId: string): Promise<void> {
  const statRows = await database
    .select({
      status: reconciliationComparison.status,
      count: sql<number>`count(*)::int`,
    })
    .from(reconciliationComparison)
    .where(eq(reconciliationComparison.sessionId, sessionId))
    .groupBy(reconciliationComparison.status);

  let matchedCount = 0;
  let needsReviewCount = 0;
  let approvedCount = 0;
  let toReviewQueueCount = 0;
  let totalFranchisees = 0;

  for (const row of statRows) {
    totalFranchisees += row.count;
    if (row.status === "auto_approved") {
      matchedCount += row.count;
      approvedCount += row.count;
    } else if (row.status === "manually_approved") {
      approvedCount += row.count;
    } else if (row.status === "needs_review") {
      needsReviewCount += row.count;
    } else if (row.status === "sent_to_review_queue") {
      toReviewQueueCount += row.count;
    }
  }

  // Determine session status
  let sessionStatus: "in_progress" | "completed" = "in_progress";
  if (needsReviewCount === 0 && toReviewQueueCount === 0) {
    sessionStatus = "completed";
  }

  await database
    .update(reconciliationSession)
    .set({
      totalFranchisees,
      matchedCount,
      needsReviewCount,
      approvedCount,
      toReviewQueueCount,
      status: sessionStatus,
      updatedAt: new Date(),
    })
    .where(eq(reconciliationSession.id, sessionId));
}

/**
 * Delete a session and all related data
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const result = await database
    .delete(reconciliationSession)
    .where(eq(reconciliationSession.id, sessionId));

  return (result.rowCount ?? 0) > 0;
}

/**
 * Get all sessions with supplier info
 */
export async function getAllSessions(filters?: {
  status?: string;
  supplierId?: string;
  limit?: number;
}): Promise<ReconciliationSessionWithDetails[]> {
  let query = database
    .select({
      id: reconciliationSession.id,
      supplierId: reconciliationSession.supplierId,
      supplierFileId: reconciliationSession.supplierFileId,
      periodStartDate: reconciliationSession.periodStartDate,
      periodEndDate: reconciliationSession.periodEndDate,
      status: reconciliationSession.status,
      totalFranchisees: reconciliationSession.totalFranchisees,
      matchedCount: reconciliationSession.matchedCount,
      needsReviewCount: reconciliationSession.needsReviewCount,
      approvedCount: reconciliationSession.approvedCount,
      toReviewQueueCount: reconciliationSession.toReviewQueueCount,
      totalSupplierAmount: reconciliationSession.totalSupplierAmount,
      totalFranchiseeAmount: reconciliationSession.totalFranchiseeAmount,
      totalDifference: reconciliationSession.totalDifference,
      fileRejectionReason: reconciliationSession.fileRejectionReason,
      fileApprovedAt: reconciliationSession.fileApprovedAt,
      fileApprovedBy: reconciliationSession.fileApprovedBy,
      runNumber: reconciliationSession.runNumber,
      parentSessionId: reconciliationSession.parentSessionId,
      archivedAt: reconciliationSession.archivedAt,
      staleAt: reconciliationSession.staleAt,
      createdAt: reconciliationSession.createdAt,
      updatedAt: reconciliationSession.updatedAt,
      createdBy: reconciliationSession.createdBy,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      supplierFileName: supplierFileUpload.originalFileName,
    })
    .from(reconciliationSession)
    .innerJoin(supplier, eq(reconciliationSession.supplierId, supplier.id))
    .innerJoin(supplierFileUpload, eq(reconciliationSession.supplierFileId, supplierFileUpload.id))
    .orderBy(desc(reconciliationSession.createdAt))
    .$dynamic();

  // Archived runs keep the status they had when they were superseded, so an
  // archived "in_progress" run shows up next to its approved replacement and
  // reads as unfinished work. The list is "סשנים פעילים" — leave them out.
  const conditions = [isNull(reconciliationSession.archivedAt)];
  if (filters?.status) {
    conditions.push(eq(reconciliationSession.status, filters.status as "in_progress" | "completed" | "file_approved" | "file_rejected"));
  }
  if (filters?.supplierId) {
    conditions.push(eq(reconciliationSession.supplierId, filters.supplierId));
  }

  query = query.where(and(...conditions));

  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  return query;
}
