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
