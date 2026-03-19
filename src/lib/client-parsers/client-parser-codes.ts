/**
 * Client-safe list of client codes that have custom parsers.
 * Keep in sync with CLIENT_PARSERS registry in ./index.ts
 */
export const CLIENT_PARSER_CODES = new Set([
  "TABIT",       // Tabit POS reports (Excel)
  "CIBUS",       // Cibus/Pluxee - HTML email body
  "TENBIS",      // Tenbis - PDF with embedded text
  "WOLT",        // Wolt - PDF tax invoice (text-based)
  "HEVER",       // Hever - Excel with all franchisees
  // Deferred to Phase 6 (need OCR):
  // "MISHLOCHA", // Mishlocha - PDF tax invoice (image-based, Hyp)
  // "HAAT",      // Haat Delivery - PDF tax invoice (image-based, Hyp)
]);

/**
 * Check if a client code has a parser (client-safe, no server imports)
 */
export function hasClientParser(clientCode: string | null | undefined): boolean {
  if (!clientCode) return false;
  return CLIENT_PARSER_CODES.has(clientCode);
}
