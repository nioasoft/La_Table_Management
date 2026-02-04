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
  supplierFileName: string;
  uploadedAt: Date;
  hasExistingSession: boolean;
  existingSessionId: string | null;
  existingSessionStatus: string | null;
}

// Extended supplier type with file info for selection
export interface SupplierWithFileInfo {
  id: string;
  name: string;
  code: string;
  fileCount: number;
  lastFileDate: Date | null;
}

// Session with details
export interface ReconciliationSessionWithDetails extends ReconciliationSession {
  supplierName: string;
  supplierCode: string;
  supplierFileName: string;
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
