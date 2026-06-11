/**
 * Client parser registry
 *
 * Each client (Cibus, Tenbis, etc.) and Tabit has a specific parser
 * registered here. Uses lazy imports to avoid loading all parsers at once.
 *
 * Pattern mirrors src/lib/custom-parsers/index.ts for supplier parsers.
 */

import type { ClientParserFn } from "./types";

export type {
  ClientParserFn,
  ClientParsedData,
  ClientDocumentProcessingResult,
  TabitParsedMatrix,
  TabitProcessingResult,
  TabitUploadSummary,
} from "./types";

// Registry of client parsers by client code (lazy-loaded)
// NOTE: TABIT is NOT registered here — it uses processTabitUpload() directly
// because it returns a matrix, not a per-franchisee result.
const CLIENT_PARSERS: Record<string, ClientParserFn> = {
  CIBUS: async (buffer, mimeType) => {
    const { parseCibusFile } = await import("./cibus-parser");
    return parseCibusFile(buffer, mimeType);
  },
  TENBIS: async (buffer, mimeType) => {
    const { parseTenbisFile } = await import("./tenbis-parser");
    return parseTenbisFile(buffer, mimeType);
  },
  WOLT: async (buffer, mimeType) => {
    const { parseWoltFile } = await import("./wolt-parser");
    return parseWoltFile(buffer, mimeType);
  },
  // HEVER: handled by processHeverUpload() directly (multi-franchisee, like Tabit)
  MISHLOCHA: async (buffer, mimeType) => {
    const { parseMishlohaFile } = await import("./mishloha-parser");
    return parseMishlohaFile(buffer, mimeType);
  },
  HAAT: async (buffer, mimeType) => {
    // Two client_report layouts exist for HAAT:
    //   1. The franchisee-issued EasyCount invoice (subject "EasyCount
    //      Invoice for HAAT") — THE document Reut reconciles as the HAAT
    //      report (2026-06-11). ezcount layout, issuer = franchisee.
    //   2. HAAT's own monthly summary ("דווח האאט", red PDF) — skipped at
    //      the webhook since 2026-06-11, but can still arrive via manual
    //      upload or the reprocess scripts.
    // Try the red-report parser first (it hard-rejects non-matching
    // files), then fall back to the ezcount invoice parser which handles
    // franchisee-issued invoices (issuer = franchisee, recipient = Haat).
    const { parseHaatReportFile } = await import("./haat-report-parser");
    const reportResult = await parseHaatReportFile(buffer, mimeType);
    if (reportResult.success) return reportResult;
    const { parseMishlohaFile } = await import("./invoice-mishloha-parser");
    return parseMishlohaFile(buffer, mimeType);
  },
};

// Registry of commission invoice parsers by client code (lazy-loaded)
const INVOICE_PARSERS: Record<string, ClientParserFn> = {
  TENBIS: async (buffer, mimeType) => {
    const { parseTenbisInvoice } = await import("./invoice-tenbis-parser");
    return parseTenbisInvoice(buffer, mimeType);
  },
  CIBUS: async (buffer, mimeType) => {
    const { parseCibusInvoice } = await import("./invoice-cibus-parser");
    return parseCibusInvoice(buffer, mimeType);
  },
  WOLT: async (buffer, mimeType) => {
    const { parseWoltInvoice } = await import("./invoice-wolt-parser");
    return parseWoltInvoice(buffer, mimeType);
  },
  MISHLOCHA: async (buffer, mimeType) => {
    const { parseMishlohaFile } = await import("./invoice-mishloha-parser");
    return parseMishlohaFile(buffer, mimeType);
  },
  HAAT: async (buffer, mimeType) => {
    // HAAT and Mishloha both issue commission invoices via ezcount in
    // identical layouts. The dedicated invoice-haat-parser was an early
    // attempt that failed to extract the franchisee on EasyCount-style
    // invoices ("לא זוהה"). The Mishloha parser handles every HAAT PDF
    // we've seen (issuer = restaurant, recipient = Haat Delivery) and
    // also produces a better franchisee name on the older HAAT files.
    const { parseMishlohaFile } = await import("./invoice-mishloha-parser");
    return parseMishlohaFile(buffer, mimeType);
  },
};

/**
 * Get a parser for a client report
 * @returns The parser function, or null if no parser exists for this code
 */
export function getClientParser(clientCode: string | null | undefined): ClientParserFn | null {
  if (!clientCode) return null;
  return CLIENT_PARSERS[clientCode] ?? null;
}

/**
 * Get a parser for a commission invoice
 * @returns The parser function, or null if no parser exists for this code
 */
export function getInvoiceParser(clientCode: string | null | undefined): ClientParserFn | null {
  if (!clientCode) return null;
  return INVOICE_PARSERS[clientCode] ?? null;
}

/**
 * Check if a client code has a registered parser
 */
export function requiresClientParser(clientCode: string): boolean {
  return clientCode in CLIENT_PARSERS;
}

/**
 * Get all registered parser codes
 */
export function getRegisteredParserCodes(): string[] {
  return Object.keys(CLIENT_PARSERS);
}
