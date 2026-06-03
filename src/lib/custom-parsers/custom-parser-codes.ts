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
  "WONG_SHU",
  "SUPER_NOVA",
  "NESPRESSO",
  "TEMPO",
  "TREZ_PAZOS",
  "MITLAND",
  "DAGEI_HAKIBBUTZIM",
  "MAKATI",
  "TNUVA",
  "לוריא",
  "YEVULEI_GOURMET",
  "SHERI_CHOCO",
  "LEUMI_CARD",
]);

// Hebrew points/diacritics (U+0591–U+05C7) and zero-width chars are invisible
// next to Latin letters and have silently broken parser dispatch in the past
// (e.g. WONGֹ_SHU mismatch with DB code WONG_SHU). Reject at module load.
for (const code of CUSTOM_PARSER_CODES) {
  if (/[֑-ׇ​-‏﻿]/.test(code)) {
    throw new Error(
      `Invalid supplier code in CUSTOM_PARSER_CODES: ${JSON.stringify(code)} ` +
        `contains a Hebrew diacritic or zero-width char. Use ASCII or unpointed Hebrew.`
    );
  }
}

/**
 * Check if a supplier code has a custom parser (client-safe)
 */
export function hasCustomParser(supplierCode: string | null | undefined): boolean {
  if (!supplierCode) return false;
  return CUSTOM_PARSER_CODES.has(supplierCode);
}
