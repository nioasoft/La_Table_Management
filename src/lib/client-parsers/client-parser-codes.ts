/**
 * Client-safe list of client codes that have report parsers.
 * Keep in sync with CLIENT_PARSERS registry in ./index.ts
 */
export const CLIENT_PARSER_CODES = new Set([
  "TABIT",       // Tabit POS reports (Excel)
  "CIBUS",       // Cibus/Pluxee - HTML email body
  "TENBIS",      // Tenbis - PDF with embedded text
  "WOLT",        // Wolt - PDF tax invoice (text-based)
  "HEVER",       // Hever - Excel with all franchisees
  // MISHLOHA & HAAT: invoice parsers only (no report parsers yet)
]);

/**
 * Client codes that have commission invoice parsers.
 * Keep in sync with INVOICE_PARSERS registry in ./index.ts
 */
export const INVOICE_PARSER_CODES = new Set([
  "TENBIS",
  "CIBUS",
  "WOLT",
  "MISHLOHA",
  "HAAT",
]);

/**
 * Check if a client code has a report parser (client-safe, no server imports)
 */
export function hasClientParser(clientCode: string | null | undefined): boolean {
  if (!clientCode) return false;
  return CLIENT_PARSER_CODES.has(clientCode);
}

/**
 * Check if a client code has an invoice parser
 */
export function hasInvoiceParser(clientCode: string | null | undefined): boolean {
  if (!clientCode) return false;
  return INVOICE_PARSER_CODES.has(clientCode);
}
