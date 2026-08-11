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
  /** Invoice number extracted from the source document (used in Hashavshevet journal export) */
  invoiceNumber?: string;
  /**
   * Israeli tax allocation number (מספר הקצאה) — 9 digits.
   * Required by Israeli tax law on invoices over ₪10,000 (dropping to ₪5,000).
   * Surfaced in the Hashavshevet journal-entries export (column K).
   */
  allocationNumber?: string;
}

/** Processing result wrapping parsed data with errors/warnings */
export interface ClientDocumentProcessingResult {
  success: boolean;
  data: ClientParsedData | null;
  errors: string[];
  warnings: string[];
  /**
   * When true, the processor MUST NOT create or update a client_document
   * row. Set by parsers that recognise an auxiliary document arriving on
   * the same email channel as real reports (e.g. 10bis "הודעת תשלום"
   * payment notifications). Without this flag the processor would create
   * a needs_review row AND overwrite any valid prior report for the same
   * franchisee+period via the dedup-replace step.
   */
  skipPersist?: boolean;
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
  /** Unique occasional-client registry rows touched by this upload */
  occasionalClientsCreated?: number;
  /** (occasional client × franchisee × period) tuples persisted */
  occasionalDocumentsCreated?: number;
}

/**
 * One tenant's slice of a MULTI-TENANT report — a single file whose contents
 * belong to several franchisees.
 *
 * 10bis started sending these in July 2026: one entity-level PDF holding a
 * section per restaurant, instead of a file per branch. A parser that can
 * split such a file exports a `(buffer) => Promise<TenantSection[]>` and
 * registers it in `getSectionExtractor` (client-parsers/index.ts); the
 * pipeline then routes the file to `processMultiTenantReport` instead of
 * `processClientDocument`, which can only ever write one franchisee.
 *
 * Returning fewer than 2 sections means "not multi-tenant" — the ordinary
 * single-franchisee path handles it.
 */
export interface TenantSection {
  /** Tenant name as printed in the document; matched via matchFranchiseeName. */
  name: string;
  /** This tenant's own total, in the same units the single-file parser reports. */
  totalAmount: number;
  /** Commission attributable to this tenant. */
  commissionAmount: number;
}

/** Splits a multi-tenant file into per-tenant sections. */
export type SectionExtractorFn = (buffer: Buffer) => Promise<TenantSection[]>;
