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
  HEVER: async (buffer, mimeType) => {
    const { parseHeverFile } = await import("./hever-parser");
    return parseHeverFile(buffer, mimeType);
  },
  // Mishlocha & Haat: same invoice format as Wolt (Hyp-generated PDF)
  // But these are image-based PDFs that need OCR - deferred to Phase 6
  // MISHLOCHA: async (buffer, mimeType) => { ... },
  // HAAT: async (buffer, mimeType) => { ... },
};

/**
 * Get a parser for a client code
 * @returns The parser function, or null if no parser exists for this code
 */
export function getClientParser(clientCode: string | null | undefined): ClientParserFn | null {
  if (!clientCode) return null;
  return CLIENT_PARSERS[clientCode] ?? null;
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
