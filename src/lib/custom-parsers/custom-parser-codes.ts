/**
 * Client-safe list of supplier codes that have custom parsers.
 * These suppliers can process files even without a file_mapping JSONB.
 *
 * Keep in sync with CUSTOM_PARSERS registry in ./index.ts
 */
export const CUSTOM_PARSER_CODES = new Set([
  "MADAG",
  "AVRAHAMI",
  "YAAKOV_AGENCIES",
  "MOR_BRIUT",
  "UNICO",
  "TAVIOT_HATZAFON",
  "MACHALVOT_GAD",
  "AREL_PACKAGING",
  "PASTA_LA_CASA",
  "ALE_ALE",
  "MIZRACH_UMAARAV",
  "FRESCO",
  "ASPIRIT",
  "FANDANGO",
  "MAADANEI_HATEVA",
  "KILL_BILL",
  "JUMON",
  "YAMA_VEKADMA",
  "KIROSKAI",
  "GREEN_TEA",
  "OREN_JUICES",
  "SOBER_LERNER",
  "WONG\u05B9_SHU",
  "SUPER_NOVA",
  "NESPRESSO",
  "TEMPO",
  "TREZ_PAZOS",
  "MITLAND",
  "DAGEI_HAKIBBUTZIM",
  "MAKATI",
  "TNUVA",
]);

/**
 * Check if a supplier code has a custom parser (client-safe)
 */
export function hasCustomParser(supplierCode: string | null | undefined): boolean {
  if (!supplierCode) return false;
  return CUSTOM_PARSER_CODES.has(supplierCode);
}
