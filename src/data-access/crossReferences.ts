import { database } from "@/db";
import {
  crossReference,
  commission,
  supplier,
  franchisee,
  settlementPeriod,
  user,
  type CrossReference,
  type CreateCrossReferenceData,
  type UpdateCrossReferenceData,
  type Supplier,
} from "@/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import type { AuditContext } from "./auditLog";
import type { BkmvParseResult, SupplierPurchaseSummary } from "@/lib/bkmvdata-parser";
import { matchBkmvSuppliers } from "@/lib/supplier-matcher";

// ============================================================================
// CROSS-REFERENCE TYPES
// ============================================================================

/**
 * Match status for cross-reference comparisons
 */
export type CrossReferenceMatchStatus = "matched" | "discrepancy" | "pending";

/**
 * Metadata structure for cross-reference comparisons
 */
export type CrossReferenceComparisonMetadata = {
  supplierAmount?: string;
  franchiseeAmount?: string;
  difference?: string;
  differencePercentage?: number;
  matchStatus?: CrossReferenceMatchStatus;
  threshold?: number;
  comparisonDate?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  commissionIds?: string[];
  adjustmentIds?: string[];
  autoMatched?: boolean;
  manualReview?: boolean;
  supplierName?: string;
  franchiseeName?: string;
  periodStartDate?: string;
  periodEndDate?: string;
  // Resolution fields for discrepancy handling
  resolutionType?: string;
  resolutionAmount?: string;
  resolutionExplanation?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  fileRequestId?: string;
};

/**
 * Extended cross-reference type with related data
 */
export type CrossReferenceWithDetails = CrossReference & {
  supplierInfo?: {
    id: string;
    name: string;
    code: string;
  } | null;
  franchiseeInfo?: {
    id: string;
    name: string;
    code: string;
  } | null;
  createdByUser?: { name: string; email: string } | null;
  comparisonMetadata?: CrossReferenceComparisonMetadata;
};

/**
 * Comparison result for supplier vs franchisee amounts
 */
export type AmountComparisonResult = {
  supplierAmount: number;
  franchiseeAmount: number;
  difference: number;
  absoluteDifference: number;
  differencePercentage: number;
  matchStatus: CrossReferenceMatchStatus;
  threshold: number;
};

/**
 * Reconciliation report entry
 */
export type ReconciliationEntry = {
  supplierId: string;
  supplierName: string;
  franchiseeId: string;
  franchiseeName: string;
  periodStartDate: string;
  periodEndDate: string;
  supplierReportedAmount: number;
  franchiseeReportedAmount: number;
  difference: number;
  matchStatus: CrossReferenceMatchStatus;
  crossReferenceId?: string;
  commissionId?: string;
};

/**
 * Reconciliation report summary
 */
export type ReconciliationReport = {
  periodId?: string;
  periodStartDate: string;
  periodEndDate: string;
  totalPairs: number;
  matchedCount: number;
  discrepancyCount: number;
  pendingCount: number;
  totalSupplierAmount: number;
  totalFranchiseeAmount: number;
  totalDifference: number;
  entries: ReconciliationEntry[];
  generatedAt: string;
};

// ============================================================================
// DEFAULT MATCHING THRESHOLD
// ============================================================================

/**
 * Default threshold for matching amounts (₪10)
 */
export const DEFAULT_MATCH_THRESHOLD = 10;

// ============================================================================
// CORE CROSS-REFERENCE FUNCTIONS
// ============================================================================

/**
 * Get all cross-references
 */
export async function getCrossReferences(): Promise<CrossReference[]> {
  return database
    .select()
    .from(crossReference)
    .orderBy(desc(crossReference.createdAt)) as unknown as Promise<CrossReference[]>;
}

/**
 * Get a single cross-reference by ID
 */
export async function getCrossReferenceById(
  id: string
): Promise<CrossReference | null> {
  const results = (await database
    .select()
    .from(crossReference)
    .where(eq(crossReference.id, id))
    .limit(1)) as unknown as CrossReference[];
  return results[0] || null;
}

/**
 * Get cross-references by source entity
 */
export async function getCrossReferencesBySource(
  sourceType: string,
  sourceId: string
): Promise<CrossReference[]> {
  return database
    .select()
    .from(crossReference)
    .where(
      and(
        eq(crossReference.sourceType, sourceType),
        eq(crossReference.sourceId, sourceId)
      )
    )
    .orderBy(desc(crossReference.createdAt)) as unknown as Promise<CrossReference[]>;
}

/**
 * Get cross-references by target entity
 */
export async function getCrossReferencesByTarget(
  targetType: string,
  targetId: string
): Promise<CrossReference[]> {
  return database
    .select()
    .from(crossReference)
    .where(
      and(
        eq(crossReference.targetType, targetType),
        eq(crossReference.targetId, targetId)
      )
    )
    .orderBy(desc(crossReference.createdAt)) as unknown as Promise<CrossReference[]>;
}

/**
 * Get cross-references by reference type
 */
export async function getCrossReferencesByType(
  referenceType: string
): Promise<CrossReference[]> {
  return database
    .select()
    .from(crossReference)
    .where(eq(crossReference.referenceType, referenceType))
    .orderBy(desc(crossReference.createdAt)) as unknown as Promise<CrossReference[]>;
}

/**
 * Create a new cross-reference
 */
export async function createCrossReference(
  data: CreateCrossReferenceData
): Promise<CrossReference> {
  const [newCrossRef] = (await database
    .insert(crossReference)
    .values(data)
    .returning()) as unknown as CrossReference[];
  return newCrossRef;
}

/**
 * Update an existing cross-reference
 */
export async function updateCrossReference(
  id: string,
  data: UpdateCrossReferenceData
): Promise<CrossReference | null> {
  const results = (await database
    .update(crossReference)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(crossReference.id, id))
    .returning()) as unknown as CrossReference[];
  return results[0] || null;
}

/**
 * Delete a cross-reference
 */
export async function deleteCrossReference(id: string): Promise<boolean> {
  const result = await database
    .delete(crossReference)
    .where(eq(crossReference.id, id));
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// AMOUNT COMPARISON FUNCTIONS
// ============================================================================

/**
 * Compare supplier vs franchisee amounts and determine match status
 * Uses threshold of ₪10 by default
 */
export function compareAmounts(
  supplierAmount: number,
  franchiseeAmount: number,
  threshold: number = DEFAULT_MATCH_THRESHOLD
): AmountComparisonResult {
  const difference = supplierAmount - franchiseeAmount;
  const absoluteDifference = Math.abs(difference);

  // Calculate percentage difference (avoid division by zero)
  const baseAmount = Math.max(supplierAmount, franchiseeAmount, 1);
  const differencePercentage = (absoluteDifference / baseAmount) * 100;

  // Determine match status based on threshold
  const matchStatus: CrossReferenceMatchStatus =
    absoluteDifference <= threshold ? "matched" : "discrepancy";

  return {
    supplierAmount,
    franchiseeAmount,
    difference,
    absoluteDifference,
    differencePercentage: Math.round(differencePercentage * 100) / 100,
    matchStatus,
    threshold,
  };
}

/**
 * Create a cross-reference for a supplier-franchisee comparison
 */
export async function createComparisonCrossReference(
  supplierId: string,
  franchiseeId: string,
  supplierAmount: number,
  franchiseeAmount: number,
  periodStartDate: string,
  periodEndDate: string,
  threshold: number = DEFAULT_MATCH_THRESHOLD,
  commissionId?: string,
  createdBy?: string
): Promise<CrossReference> {
  const comparison = compareAmounts(supplierAmount, franchiseeAmount, threshold);

  // Get supplier and franchisee names for metadata
  const [supplierData] = await database
    .select({ name: supplier.name })
    .from(supplier)
    .where(eq(supplier.id, supplierId))
    .limit(1);

  const [franchiseeData] = await database
    .select({ name: franchisee.name })
    .from(franchisee)
    .where(eq(franchisee.id, franchiseeId))
    .limit(1);

  const metadata: CrossReferenceComparisonMetadata = {
    supplierAmount: supplierAmount.toFixed(2),
    franchiseeAmount: franchiseeAmount.toFixed(2),
    difference: comparison.difference.toFixed(2),
    differencePercentage: comparison.differencePercentage,
    matchStatus: comparison.matchStatus,
    threshold,
    comparisonDate: new Date().toISOString(),
    autoMatched: comparison.matchStatus === "matched",
    manualReview: comparison.matchStatus === "discrepancy",
    supplierName: supplierData?.name,
    franchiseeName: franchiseeData?.name,
    periodStartDate,
    periodEndDate,
    commissionIds: commissionId ? [commissionId] : [],
  };

  const crossRefData: CreateCrossReferenceData = {
    id: crypto.randomUUID(),
    sourceType: "supplier",
    sourceId: supplierId,
    targetType: "franchisee",
    targetId: franchiseeId,
    referenceType: "amount_comparison",
    referenceCode: `${supplierId}-${franchiseeId}-${periodStartDate}`,
    description: `Amount comparison for period ${periodStartDate} to ${periodEndDate}`,
    metadata,
    isActive: true,
    createdBy: createdBy || null,
  };

  return createCrossReference(crossRefData);
}

/**
 * Update match status for a cross-reference (for manual review)
 */
export async function updateMatchStatus(
  crossRefId: string,
  newStatus: CrossReferenceMatchStatus,
  reviewedBy: string,
  reviewNotes?: string
): Promise<CrossReference | null> {
  const existing = await getCrossReferenceById(crossRefId);
  if (!existing) return null;

  const currentMetadata = (existing.metadata as CrossReferenceComparisonMetadata) || {};

  const updatedMetadata: CrossReferenceComparisonMetadata = {
    ...currentMetadata,
    matchStatus: newStatus,
    reviewedBy,
    reviewedAt: new Date().toISOString(),
    reviewNotes: reviewNotes || currentMetadata.reviewNotes,
    manualReview: false, // No longer needs review
  };

  return updateCrossReference(crossRefId, {
    metadata: updatedMetadata,
  });
}

// ============================================================================
// RECONCILIATION REPORT FUNCTIONS
// ============================================================================

/**
 * Get all cross-references with comparison metadata for a period
 */
export async function getComparisonsByPeriod(
  periodStartDate: string,
  periodEndDate: string
): Promise<CrossReferenceWithDetails[]> {
  const results = await database
    .select({
      crossRef: crossReference,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      createdByName: user.name,
      createdByEmail: user.email,
    })
    .from(crossReference)
    .leftJoin(supplier, eq(crossReference.sourceId, supplier.id))
    .leftJoin(franchisee, eq(crossReference.targetId, franchisee.id))
    .leftJoin(user, eq(crossReference.createdBy, user.id))
    .where(
      and(
        eq(crossReference.referenceType, "amount_comparison"),
        eq(crossReference.isActive, true)
      )
    )
    .orderBy(desc(crossReference.createdAt));

  // Filter by period dates in metadata
  return results
    .filter((row) => {
      const metadata = row.crossRef.metadata as CrossReferenceComparisonMetadata;
      return (
        metadata?.periodStartDate === periodStartDate &&
        metadata?.periodEndDate === periodEndDate
      );
    })
    .map((row) => ({
      ...row.crossRef,
      supplierInfo: row.supplierName
        ? {
            id: row.crossRef.sourceId,
            name: row.supplierName,
            code: row.supplierCode!,
          }
        : null,
      franchiseeInfo: row.franchiseeName
        ? {
            id: row.crossRef.targetId,
            name: row.franchiseeName,
            code: row.franchiseeCode!,
          }
        : null,
      createdByUser: row.createdByName
        ? { name: row.createdByName, email: row.createdByEmail! }
        : null,
      comparisonMetadata: row.crossRef.metadata as CrossReferenceComparisonMetadata,
    }));
}

/**
 * Get discrepancies (cross-references that need review)
 */
export async function getDiscrepancies(): Promise<CrossReferenceWithDetails[]> {
  const results = await database
    .select({
      crossRef: crossReference,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      createdByName: user.name,
      createdByEmail: user.email,
    })
    .from(crossReference)
    .leftJoin(supplier, eq(crossReference.sourceId, supplier.id))
    .leftJoin(franchisee, eq(crossReference.targetId, franchisee.id))
    .leftJoin(user, eq(crossReference.createdBy, user.id))
    .where(
      and(
        eq(crossReference.referenceType, "amount_comparison"),
        eq(crossReference.isActive, true)
      )
    )
    .orderBy(desc(crossReference.createdAt));

  // Filter by discrepancy status in metadata
  return results
    .filter((row) => {
      const metadata = row.crossRef.metadata as CrossReferenceComparisonMetadata;
      return metadata?.matchStatus === "discrepancy" && metadata?.manualReview !== false;
    })
    .map((row) => ({
      ...row.crossRef,
      supplierInfo: row.supplierName
        ? {
            id: row.crossRef.sourceId,
            name: row.supplierName,
            code: row.supplierCode!,
          }
        : null,
      franchiseeInfo: row.franchiseeName
        ? {
            id: row.crossRef.targetId,
            name: row.franchiseeName,
            code: row.franchiseeCode!,
          }
        : null,
      createdByUser: row.createdByName
        ? { name: row.createdByName, email: row.createdByEmail! }
        : null,
      comparisonMetadata: row.crossRef.metadata as CrossReferenceComparisonMetadata,
    }));
}

/**
 * Generate a reconciliation report for a period
 */
export async function generateReconciliationReport(
  periodStartDate: string,
  periodEndDate: string,
  supplierId?: string,
  franchiseeId?: string
): Promise<ReconciliationReport> {
  const comparisons = await getComparisonsByPeriod(periodStartDate, periodEndDate);

  // Filter by supplier/franchisee if specified
  let filteredComparisons = comparisons;
  if (supplierId) {
    filteredComparisons = filteredComparisons.filter(
      (c) => c.sourceId === supplierId
    );
  }
  if (franchiseeId) {
    filteredComparisons = filteredComparisons.filter(
      (c) => c.targetId === franchiseeId
    );
  }

  // Build report entries
  const entries: ReconciliationEntry[] = filteredComparisons.map((c) => {
    const metadata = c.comparisonMetadata || {};
    return {
      supplierId: c.sourceId,
      supplierName: c.supplierInfo?.name || metadata.supplierName || "Unknown",
      franchiseeId: c.targetId,
      franchiseeName: c.franchiseeInfo?.name || metadata.franchiseeName || "Unknown",
      periodStartDate: metadata.periodStartDate || periodStartDate,
      periodEndDate: metadata.periodEndDate || periodEndDate,
      supplierReportedAmount: parseFloat(metadata.supplierAmount || "0"),
      franchiseeReportedAmount: parseFloat(metadata.franchiseeAmount || "0"),
      difference: parseFloat(metadata.difference || "0"),
      matchStatus: metadata.matchStatus || "pending",
      crossReferenceId: c.id,
      commissionId: metadata.commissionIds?.[0],
    };
  });

  // Calculate totals
  const matchedCount = entries.filter((e) => e.matchStatus === "matched").length;
  const discrepancyCount = entries.filter((e) => e.matchStatus === "discrepancy").length;
  const pendingCount = entries.filter((e) => e.matchStatus === "pending").length;

  const totalSupplierAmount = entries.reduce(
    (sum, e) => sum + e.supplierReportedAmount,
    0
  );
  const totalFranchiseeAmount = entries.reduce(
    (sum, e) => sum + e.franchiseeReportedAmount,
    0
  );
  const totalDifference = entries.reduce(
    (sum, e) => sum + Math.abs(e.difference),
    0
  );

  return {
    periodStartDate,
    periodEndDate,
    totalPairs: entries.length,
    matchedCount,
    discrepancyCount,
    pendingCount,
    totalSupplierAmount: Math.round(totalSupplierAmount * 100) / 100,
    totalFranchiseeAmount: Math.round(totalFranchiseeAmount * 100) / 100,
    totalDifference: Math.round(totalDifference * 100) / 100,
    entries,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get reconciliation statistics
 */
export async function getReconciliationStats(): Promise<{
  total: number;
  matched: number;
  discrepancies: number;
  pending: number;
  bySupplier: Record<string, { matched: number; discrepancy: number }>;
}> {
  const allComparisons = await getCrossReferencesByType("amount_comparison");

  const stats = {
    total: allComparisons.length,
    matched: 0,
    discrepancies: 0,
    pending: 0,
    bySupplier: {} as Record<string, { matched: number; discrepancy: number }>,
  };

  for (const comp of allComparisons) {
    const metadata = comp.metadata as CrossReferenceComparisonMetadata;
    const status = metadata?.matchStatus || "pending";
    const supplierId = comp.sourceId;

    if (status === "matched") {
      stats.matched++;
    } else if (status === "discrepancy") {
      stats.discrepancies++;
    } else {
      stats.pending++;
    }

    // Track by supplier
    if (!stats.bySupplier[supplierId]) {
      stats.bySupplier[supplierId] = { matched: 0, discrepancy: 0 };
    }
    if (status === "matched") {
      stats.bySupplier[supplierId].matched++;
    } else if (status === "discrepancy") {
      stats.bySupplier[supplierId].discrepancy++;
    }
  }

  return stats;
}

/**
 * Perform bulk comparison for commissions in a period
 * This compares all commission records for a given period and creates cross-references
 */
export async function performBulkComparison(
  periodStartDate: string,
  periodEndDate: string,
  threshold: number = DEFAULT_MATCH_THRESHOLD,
  createdBy?: string
): Promise<{
  created: number;
  matched: number;
  discrepancies: number;
  crossReferences: CrossReference[];
}> {
  // Get all commissions for the period
  const commissions = await database
    .select({
      id: commission.id,
      supplierId: commission.supplierId,
      franchiseeId: commission.franchiseeId,
      grossAmount: commission.grossAmount,
      supplierName: supplier.name,
      franchiseeName: franchisee.name,
    })
    .from(commission)
    .leftJoin(supplier, eq(commission.supplierId, supplier.id))
    .leftJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
    .where(
      and(
        eq(commission.periodStartDate, periodStartDate),
        eq(commission.periodEndDate, periodEndDate)
      )
    );

  const results = {
    created: 0,
    matched: 0,
    discrepancies: 0,
    crossReferences: [] as CrossReference[],
  };

  // For each commission, create a cross-reference
  // Note: In a real scenario, you'd compare supplier-reported vs franchisee-reported amounts
  // Here we're using the commission gross amount as the supplier amount
  // The franchisee amount would come from a separate source (e.g., franchisee's own report)
  for (const comm of commissions) {
    // For demo purposes, simulate franchisee-reported amount with slight variation
    // In production, this would come from actual franchisee reports
    const supplierAmount = parseFloat(comm.grossAmount || "0");

    // Check if cross-reference already exists
    const existingRefs = await database
      .select()
      .from(crossReference)
      .where(
        and(
          eq(crossReference.sourceType, "supplier"),
          eq(crossReference.sourceId, comm.supplierId),
          eq(crossReference.targetType, "franchisee"),
          eq(crossReference.targetId, comm.franchiseeId),
          eq(crossReference.referenceType, "amount_comparison")
        )
      );

    const existingForPeriod = existingRefs.filter((ref) => {
      const metadata = ref.metadata as CrossReferenceComparisonMetadata;
      return (
        metadata?.periodStartDate === periodStartDate &&
        metadata?.periodEndDate === periodEndDate
      );
    });

    if (existingForPeriod.length === 0) {
      // No existing cross-reference, create one with supplier amount
      // Franchisee amount defaults to 0 until franchisee report is uploaded
      const crossRef = await createComparisonCrossReference(
        comm.supplierId,
        comm.franchiseeId,
        supplierAmount,
        0, // Franchisee amount - to be filled in when franchisee reports
        periodStartDate,
        periodEndDate,
        threshold,
        comm.id,
        createdBy
      );

      results.created++;
      const metadata = crossRef.metadata as CrossReferenceComparisonMetadata;
      if (metadata?.matchStatus === "matched") {
        results.matched++;
      } else {
        results.discrepancies++;
      }
      results.crossReferences.push(crossRef);
    }
  }

  return results;
}

/**
 * Update franchisee reported amount for a cross-reference
 */
export async function updateFranchiseeAmount(
  crossRefId: string,
  franchiseeAmount: number,
  threshold: number = DEFAULT_MATCH_THRESHOLD
): Promise<CrossReference | null> {
  const existing = await getCrossReferenceById(crossRefId);
  if (!existing) return null;

  const currentMetadata = (existing.metadata as CrossReferenceComparisonMetadata) || {};
  const supplierAmount = parseFloat(currentMetadata.supplierAmount || "0");

  // Recalculate comparison
  const comparison = compareAmounts(supplierAmount, franchiseeAmount, threshold);

  const updatedMetadata: CrossReferenceComparisonMetadata = {
    ...currentMetadata,
    franchiseeAmount: franchiseeAmount.toFixed(2),
    difference: comparison.difference.toFixed(2),
    differencePercentage: comparison.differencePercentage,
    matchStatus: comparison.matchStatus,
    threshold,
    autoMatched: comparison.matchStatus === "matched",
    manualReview: comparison.matchStatus === "discrepancy",
    comparisonDate: new Date().toISOString(),
  };

  return updateCrossReference(crossRefId, {
    metadata: updatedMetadata,
  });
}

// ============================================================================
// BKMVDATA PROCESSING FUNCTIONS
// ============================================================================

/**
 * Result of processing BKMVDATA for a franchisee
 */
export interface BkmvDataProcessingResult {
  franchiseeId: string;
  franchiseeName: string;
  periodStartDate: string;
  periodEndDate: string;
  suppliersProcessed: number;
  suppliersMatched: number;
  suppliersUnmatched: number;
  crossReferencesUpdated: number;
  crossReferencesCreated: number;
  matchedSuppliers: Array<{
    bkmvName: string;
    supplierId: string;
    supplierName: string;
    amount: number;
    confidence: number;
    crossRefId: string;
    matchStatus: CrossReferenceMatchStatus;
  }>;
  unmatchedSuppliers: Array<{
    bkmvName: string;
    amount: number;
    transactionCount: number;
  }>;
  errors: string[];
}

/**
 * Find or create cross-reference for a supplier-franchisee pair in a period
 */
async function findOrCreateCrossReference(
  supplierId: string,
  franchiseeId: string,
  periodStartDate: string,
  periodEndDate: string,
  createdBy?: string
): Promise<CrossReference> {
  // Look for existing cross-reference
  const existingRefs = await database
    .select()
    .from(crossReference)
    .where(
      and(
        eq(crossReference.sourceType, "supplier"),
        eq(crossReference.sourceId, supplierId),
        eq(crossReference.targetType, "franchisee"),
        eq(crossReference.targetId, franchiseeId),
        eq(crossReference.referenceType, "amount_comparison")
      )
    );

  // Check if one exists for this period
  const existingForPeriod = existingRefs.find((ref) => {
    const metadata = ref.metadata as CrossReferenceComparisonMetadata;
    return (
      metadata?.periodStartDate === periodStartDate &&
      metadata?.periodEndDate === periodEndDate
    );
  });

  if (existingForPeriod) {
    return existingForPeriod;
  }

  // Create new cross-reference with franchisee amount = 0
  // This will be updated when we have both amounts
  return createComparisonCrossReference(
    supplierId,
    franchiseeId,
    0, // Supplier amount - to be filled when supplier report arrives
    0, // Franchisee amount - to be filled now
    periodStartDate,
    periodEndDate,
    DEFAULT_MATCH_THRESHOLD,
    undefined,
    createdBy
  );
}

/**
 * Process BKMVDATA file for a franchisee and update cross-references
 *
 * @param franchiseeId - The franchisee ID
 * @param bkmvData - Parsed BKMVDATA result
 * @param periodStartDate - Start date of the period (YYYY-MM-DD)
 * @param periodEndDate - End date of the period (YYYY-MM-DD)
 * @param createdBy - User who initiated the processing
 * @returns Processing result with statistics
 */
export async function processFranchiseeBkmvData(
  franchiseeId: string,
  bkmvData: BkmvParseResult,
  periodStartDate: string,
  periodEndDate: string,
  createdBy?: string
): Promise<BkmvDataProcessingResult> {
  // Get franchisee info
  const [franchiseeData] = await database
    .select({ name: franchisee.name })
    .from(franchisee)
    .where(eq(franchisee.id, franchiseeId))
    .limit(1);

  if (!franchiseeData) {
    throw new Error(`Franchisee not found: ${franchiseeId}`);
  }

  // Get all suppliers for matching
  const suppliers = await database
    .select()
    .from(supplier)
    .where(eq(supplier.isActive, true)) as unknown as Supplier[];

  // Match BKMV suppliers to system suppliers
  const matchingResults = matchBkmvSuppliers(
    bkmvData.supplierSummary,
    suppliers,
    { minConfidence: 0.6, reviewThreshold: 0.85 }
  );

  const result: BkmvDataProcessingResult = {
    franchiseeId,
    franchiseeName: franchiseeData.name,
    periodStartDate,
    periodEndDate,
    suppliersProcessed: matchingResults.length,
    suppliersMatched: 0,
    suppliersUnmatched: 0,
    crossReferencesUpdated: 0,
    crossReferencesCreated: 0,
    matchedSuppliers: [],
    unmatchedSuppliers: [],
    errors: [],
  };

  // Process each matched supplier
  for (const match of matchingResults) {
    if (match.matchResult.matchedSupplier) {
      const matchedSupplier = match.matchResult.matchedSupplier;
      result.suppliersMatched++;

      try {
        // Find or create cross-reference
        const crossRef = await findOrCreateCrossReference(
          matchedSupplier.id,
          franchiseeId,
          periodStartDate,
          periodEndDate,
          createdBy
        );

        const isNew = !crossRef.updatedAt || crossRef.createdAt === crossRef.updatedAt;

        // Update the franchisee amount
        const metadata = crossRef.metadata as CrossReferenceComparisonMetadata;
        const supplierAmount = parseFloat(metadata?.supplierAmount || "0");
        const comparison = compareAmounts(supplierAmount, match.amount);

        const updatedMetadata: CrossReferenceComparisonMetadata = {
          ...metadata,
          franchiseeAmount: match.amount.toFixed(2),
          difference: comparison.difference.toFixed(2),
          differencePercentage: comparison.differencePercentage,
          matchStatus: supplierAmount > 0 ? comparison.matchStatus : "pending",
          threshold: comparison.threshold,
          autoMatched: supplierAmount > 0 && comparison.matchStatus === "matched",
          manualReview: supplierAmount > 0 && comparison.matchStatus === "discrepancy",
          comparisonDate: new Date().toISOString(),
          franchiseeName: franchiseeData.name,
          supplierName: matchedSupplier.name,
        };

        await updateCrossReference(crossRef.id, {
          metadata: updatedMetadata,
        });

        if (isNew) {
          result.crossReferencesCreated++;
        } else {
          result.crossReferencesUpdated++;
        }

        result.matchedSuppliers.push({
          bkmvName: match.bkmvName,
          supplierId: matchedSupplier.id,
          supplierName: matchedSupplier.name,
          amount: match.amount,
          confidence: match.matchResult.confidence,
          crossRefId: crossRef.id,
          matchStatus: supplierAmount > 0 ? comparison.matchStatus : "pending",
        });
      } catch (error) {
        result.errors.push(`Error processing ${match.bkmvName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else {
      result.suppliersUnmatched++;
      result.unmatchedSuppliers.push({
        bkmvName: match.bkmvName,
        amount: match.amount,
        transactionCount: match.transactionCount,
      });
    }
  }

  return result;
}

/**
 * Get cross-references for a specific franchisee and period
 */
export async function getCrossReferencesByFranchiseeAndPeriod(
  franchiseeId: string,
  periodStartDate: string,
  periodEndDate: string
): Promise<CrossReferenceWithDetails[]> {
  const results = await database
    .select({
      crossRef: crossReference,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      createdByName: user.name,
      createdByEmail: user.email,
    })
    .from(crossReference)
    .leftJoin(supplier, eq(crossReference.sourceId, supplier.id))
    .leftJoin(franchisee, eq(crossReference.targetId, franchisee.id))
    .leftJoin(user, eq(crossReference.createdBy, user.id))
    .where(
      and(
        eq(crossReference.targetType, "franchisee"),
        eq(crossReference.targetId, franchiseeId),
        eq(crossReference.referenceType, "amount_comparison"),
        eq(crossReference.isActive, true)
      )
    )
    .orderBy(desc(crossReference.createdAt));

  // Filter by period dates in metadata
  return results
    .filter((row) => {
      const metadata = row.crossRef.metadata as CrossReferenceComparisonMetadata;
      return (
        metadata?.periodStartDate === periodStartDate &&
        metadata?.periodEndDate === periodEndDate
      );
    })
    .map((row) => ({
      ...row.crossRef,
      supplierInfo: row.supplierName
        ? {
            id: row.crossRef.sourceId,
            name: row.supplierName,
            code: row.supplierCode!,
          }
        : null,
      franchiseeInfo: row.franchiseeName
        ? {
            id: row.crossRef.targetId,
            name: row.franchiseeName,
            code: row.franchiseeCode!,
          }
        : null,
      createdByUser: row.createdByName
        ? { name: row.createdByName, email: row.createdByEmail! }
        : null,
      comparisonMetadata: row.crossRef.metadata as CrossReferenceComparisonMetadata,
    }));
}

/**
 * Get all cross-references for comparison view (admin)
 */
export async function getAllCrossReferencesForComparison(
  periodStartDate?: string,
  periodEndDate?: string
): Promise<CrossReferenceWithDetails[]> {
  const results = await database
    .select({
      crossRef: crossReference,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      createdByName: user.name,
      createdByEmail: user.email,
    })
    .from(crossReference)
    .leftJoin(supplier, eq(crossReference.sourceId, supplier.id))
    .leftJoin(franchisee, eq(crossReference.targetId, franchisee.id))
    .leftJoin(user, eq(crossReference.createdBy, user.id))
    .where(
      and(
        eq(crossReference.referenceType, "amount_comparison"),
        eq(crossReference.isActive, true)
      )
    )
    .orderBy(desc(crossReference.createdAt));

  // Filter by period if provided
  let filteredResults = results;
  if (periodStartDate && periodEndDate) {
    filteredResults = results.filter((row) => {
      const metadata = row.crossRef.metadata as CrossReferenceComparisonMetadata;
      return (
        metadata?.periodStartDate === periodStartDate &&
        metadata?.periodEndDate === periodEndDate
      );
    });
  }

  return filteredResults.map((row) => ({
    ...row.crossRef,
    supplierInfo: row.supplierName
      ? {
          id: row.crossRef.sourceId,
          name: row.supplierName,
          code: row.supplierCode!,
        }
      : null,
    franchiseeInfo: row.franchiseeName
      ? {
          id: row.crossRef.targetId,
          name: row.franchiseeName,
          code: row.franchiseeCode!,
        }
      : null,
    createdByUser: row.createdByName
      ? { name: row.createdByName, email: row.createdByEmail! }
      : null,
    comparisonMetadata: row.crossRef.metadata as CrossReferenceComparisonMetadata,
  }));
}
