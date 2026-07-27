// Shared types for reconciliation-v2 module
// These types can be used in both client and server components

export const RECONCILIATION_THRESHOLD = 30;

export type ReconciliationSessionStatus =
  | "in_progress"
  | "completed"
  | "file_approved"
  | "file_rejected";

export type ReconciliationComparisonStatus =
  | "pending"
  | "auto_approved"
  | "needs_review"
  | "manually_approved"
  | "sent_to_review_queue";

export type ReconciliationReviewQueueStatus = "pending" | "resolved";

export interface ReconciliationSession {
  id: string;
  supplierId: string;
  supplierFileId: string | null;
  periodStartDate: string;
  periodEndDate: string;
  status: ReconciliationSessionStatus;
  totalFranchisees: number;
  matchedCount: number;
  needsReviewCount: number;
  approvedCount: number;
  toReviewQueueCount: number;
  totalSupplierAmount: string | null;
  totalFranchiseeAmount: string | null;
  totalDifference: string | null;
  fileRejectionReason: string | null;
  fileApprovedAt: Date | null;
  fileApprovedBy: string | null;
  // Run versioning — Match-All clones the active session into a new run.
  runNumber: number;
  parentSessionId: string | null;
  archivedAt: Date | null;
  // Set when a newer supplier file or BKMV upload landed for this period after
  // the session was built — the UI prompts a rebuild.
  staleAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface ReconciliationSessionWithSupplier extends ReconciliationSession {
  supplierName: string;
}

export interface ReconciliationComparison {
  id: string;
  sessionId: string;
  franchiseeId: string;
  supplierAmount: string | null;
  franchiseeAmount: string | null;
  difference: string | null;
  absoluteDifference: string | null;
  supplierOriginalName: string | null;
  franchiseeFileId: string | null;
  status: ReconciliationComparisonStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReconciliationComparisonWithDetails extends ReconciliationComparison {
  franchiseeName: string;
  franchiseeCode: string;
  brandName: string | null;
}

export interface ReconciliationReviewQueueItem {
  id: string;
  comparisonId: string;
  sessionId: string;
  supplierId: string;
  supplierName: string;
  franchiseeId: string;
  franchiseeName: string;
  periodStartDate: string;
  periodEndDate: string;
  supplierAmount: string | null;
  franchiseeAmount: string | null;
  difference: string | null;
  status: ReconciliationReviewQueueStatus;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupplierWithFileCount {
  id: string;
  name: string;
  fileCount: number;
}

export interface SupplierPeriod {
  periodKey: string;
  periodStartDate: string;
  periodEndDate: string;
  supplierFileId: string;
  supplierFileIds: string[]; // All file IDs for this period (for multi-file suppliers)
  supplierFileName: string;
  uploadedAt: Date;
  hasExistingSession: boolean;
  existingSessionId: string | null;
  existingSessionStatus: string | null;
}

// A (supplier × period) pair that has a supplier file but no active session.
// Mirrors SessionlessPeriod in src/data-access/reconciliation-v2.ts.
export interface SessionlessPeriod {
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
}

// Extended supplier type with file info for selection
export interface SupplierWithFileInfo {
  id: string;
  name: string;
  code: string;
  fileCount: number;
  lastFileDate: Date | null;
  notes: string | null;
}

// Session with details
export interface ReconciliationSessionWithDetails extends ReconciliationSession {
  supplierName: string;
  supplierCode: string;
  supplierFileName: string;
  /**
   * Set on creation when the supplier has no brand mapping and no history to
   * infer one from. Session building then skips zero-amount row generation, so
   * branches with no activity are silently absent. Not persisted — it describes
   * the build, not the session.
   */
  brandMappingMissing?: boolean;
}

// History item for display
export interface ReconciliationHistoryItem {
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
}
