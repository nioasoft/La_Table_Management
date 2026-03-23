/**
 * Types for client document parsers.
 *
 * Each client (Cibus, Tenbis, etc.) and Tabit has a specific parser
 * that extracts financial data from their document format.
 */

/** Parsed line item from a client document */
export interface ClientParsedLineItem {
  date: Date | null;
  description: string;
  amount: number;
  commission: number;
}

/** Result of parsing a client document */
export interface ClientParsedData {
  /** Franchisee name as it appears in the document */
  franchiseeName: string;
  /** Total transaction amount (gross, before commission deduction) */
  totalAmount: number;
  /** Commission amount charged by the client */
  commissionAmount: number;
  /** Commission rate as percentage (e.g. 3.5 for 3.5%) */
  commissionRate: number;
  /** Net amount = totalAmount - commissionAmount (what to invoice) */
  netAmount: number;
  /** Number of transactions in the period */
  transactionCount?: number;
  /** Period month (1-12) extracted from the document */
  periodMonth?: number;
  /** Period year extracted from the document */
  periodYear?: number;
  /** Individual line items if available */
  lineItems?: ClientParsedLineItem[];
  /** Raw text from OCR (for PDF documents) */
  rawText?: string;
}

/** Processing result wrapping parsed data with errors/warnings */
export interface ClientDocumentProcessingResult {
  success: boolean;
  data: ClientParsedData | null;
  errors: string[];
  warnings: string[];
}

/** Parser function signature - takes a file buffer and mime type, returns parsed data */
export type ClientParserFn = (
  buffer: Buffer,
  mimeType: string
) => Promise<ClientDocumentProcessingResult>;

// ============================================================================
// TABIT PIVOT TABLE TYPES
// ============================================================================

/** A single branch row from the Tabit pivot table */
export interface TabitBranchRow {
  /** Branch name as it appears in the Tabit file */
  branchName: string;
  /** Payment method → amount mapping */
  amounts: Record<string, number>;
  /** Total column value */
  total: number;
}

/** Parsed Tabit pivot table matrix */
export interface TabitParsedMatrix {
  /** Extracted period from the file */
  period: { month: number; year: number } | null;
  /** All branch data rows (excluding Total/summary rows) */
  branches: TabitBranchRow[];
  /** All payment method column names found in the file */
  paymentMethods: string[];
}

/** Result of parsing a Tabit Excel file */
export interface TabitProcessingResult {
  success: boolean;
  data: TabitParsedMatrix | null;
  errors: string[];
  warnings: string[];
}

/** Summary returned after processing a Tabit upload into client_document records */
export interface TabitUploadSummary {
  /** Number of new client_document records created */
  documentsCreated: number;
  /** Number of existing client_document records updated */
  documentsUpdated: number;
  /** Branch names that could not be matched to a franchisee */
  unmatchedBranches: string[];
  /** Payment method columns with non-zero amounts that have no matching client */
  unmappedColumns: string[];
  /** Number of (franchisee × client) pairs skipped because amount was 0 */
  skippedZeroAmounts: number;
  /** Period extracted from the file */
  period: { month: number; year: number } | null;
  /** URL of the uploaded original file */
  fileUrl: string;
}
