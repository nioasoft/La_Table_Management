/**
 * Custom parsers for suppliers with complex file formats
 *
 * These parsers handle non-standard file structures that can't be processed
 * by the generic file processor.
 */

export { parseMadagFile } from "./madag-parser";
export { parseAvrahamiFile } from "./avrahami-parser";
export { parseYaakovAgenciesFile } from "./yaakov-agencies-parser";
export { parseMorBriutFile } from "./mor-briut-parser";
export { parseUnikoFile } from "./uniko-parser";
export { parseTuviotHatzafonFile } from "./tuviot-hatzafon-parser";
export { parseMachlavotGadFile } from "./machlavot-gad-parser";
export { parseArelArizotFile } from "./arel-arizot-parser";
export { parsePastaLaCasaFile } from "./pasta-la-casa-parser";
export { parseAleAleFile } from "./ale-ale-parser";
export { parseMizrachUmaaravFile } from "./mizrach-umaarav-parser";
export { parseFrescoFile } from "./fresco-parser";
export { parseAspiritFile } from "./aspirit-parser";
export { parseFandangoFile } from "./fandango-parser";
export { parseMaadaneiHatevaFile } from "./maadanei-hateva-parser";
export { parseKillBillFile } from "./kill-bill-parser";
export { parseJumonFile } from "./jumon-parser";
export { parseYamaVekadmaFile } from "./yama-vekadma-parser";
export { parseKiroskaiFile } from "./kiroskai-parser";
export { parseGreenTeaFile } from "./green-tea-parser";
export { parseOrenJuicesFile } from "./oren-juices-parser";
export { parseSoberLernerFile } from "./sober-lerner-parser";
export { parseWongShuFile } from "./wong-shu-parser";
export { parseSuperNovaFile } from "./super-nova-parser";
export { parseNespressoFile } from "./nespresso-parser";
export { parseTempoFile } from "./tempo-parser";
export { parseTrezPazosFile } from "./trez-pazos-parser";
export { parseMitlandFile } from "./mitland-parser";

// Custom parser function type - accepts buffer, optional vatRate, and optional vatProducts
export type CustomParserFn = (
  buffer: Buffer,
  vatRate?: number,
  vatProducts?: Set<string>
) => Promise<import("../file-processor").FileProcessingResult>;

// Registry of custom parsers by supplier code
export const CUSTOM_PARSERS: Record<string, CustomParserFn> = {
  MADAG: async (buffer, vatRate) => {
    const { parseMadagFile } = await import("./madag-parser");
    return parseMadagFile(buffer);
  },
  AVRAHAMI: async (buffer, vatRate) => {
    const { parseAvrahamiFile } = await import("./avrahami-parser");
    return parseAvrahamiFile(buffer);
  },
  YAAKOV_AGENCIES: async (buffer, vatRate) => {
    const { parseYaakovAgenciesFile } = await import("./yaakov-agencies-parser");
    return parseYaakovAgenciesFile(buffer);
  },
  MOR_BRIUT: async (buffer, vatRate) => {
    const { parseMorBriutFile } = await import("./mor-briut-parser");
    return parseMorBriutFile(buffer);
  },
  UNICO: async (buffer, vatRate) => {
    const { parseUnikoFile } = await import("./uniko-parser");
    return parseUnikoFile(buffer);
  },
  // Note: Database uses TAVIOT (with A), not TUVIOT (with U)
  TAVIOT_HATZAFON: async (buffer, vatRate) => {
    const { parseTuviotHatzafonFile } = await import("./tuviot-hatzafon-parser");
    return parseTuviotHatzafonFile(buffer);
  },
  MACHALVOT_GAD: async (buffer, vatRate) => {
    const { parseMachlavotGadFile } = await import("./machlavot-gad-parser");
    return parseMachlavotGadFile(buffer);
  },
  AREL_PACKAGING: async (buffer, vatRate) => {
    const { parseArelArizotFile } = await import("./arel-arizot-parser");
    return parseArelArizotFile(buffer);
  },
  PASTA_LA_CASA: async (buffer, vatRate) => {
    const { parsePastaLaCasaFile } = await import("./pasta-la-casa-parser");
    return parsePastaLaCasaFile(buffer, vatRate);
  },
  ALE_ALE: async (buffer, vatRate, vatProducts) => {
    const { parseAleAleFile } = await import("./ale-ale-parser");
    return parseAleAleFile(buffer, vatRate, vatProducts);
  },
  MIZRACH_UMAARAV: async (buffer, vatRate) => {
    const { parseMizrachUmaaravFile } = await import("./mizrach-umaarav-parser");
    return parseMizrachUmaaravFile(buffer);
  },
  FRESCO: async (buffer, vatRate) => {
    const { parseFrescoFile } = await import("./fresco-parser");
    return parseFrescoFile(buffer);
  },
  ASPIRIT: async (buffer, vatRate) => {
    const { parseAspiritFile } = await import("./aspirit-parser");
    return parseAspiritFile(buffer);
  },
  FANDANGO: async (buffer, vatRate) => {
    const { parseFandangoFile } = await import("./fandango-parser");
    return parseFandangoFile(buffer);
  },
  MAADANEI_HATEVA: async (buffer, vatRate) => {
    const { parseMaadaneiHatevaFile } = await import("./maadanei-hateva-parser");
    return parseMaadaneiHatevaFile(buffer);
  },
  KILL_BILL: async (buffer, vatRate) => {
    const { parseKillBillFile } = await import("./kill-bill-parser");
    return parseKillBillFile(buffer);
  },
  JUMON: async (buffer, vatRate) => {
    const { parseJumonFile } = await import("./jumon-parser");
    return parseJumonFile(buffer);
  },
  YAMA_VEKADMA: async (buffer, vatRate) => {
    const { parseYamaVekadmaFile } = await import("./yama-vekadma-parser");
    return parseYamaVekadmaFile(buffer);
  },
  KIROSKAI: async (buffer, vatRate) => {
    const { parseKiroskaiFile } = await import("./kiroskai-parser");
    return parseKiroskaiFile(buffer);
  },
  GREEN_TEA: async (buffer, vatRate) => {
    const { parseGreenTeaFile } = await import("./green-tea-parser");
    return parseGreenTeaFile(buffer);
  },
  OREN_JUICES: async (buffer, vatRate) => {
    const { parseOrenJuicesFile } = await import("./oren-juices-parser");
    return parseOrenJuicesFile(buffer);
  },
  SOBER_LERNER: async (buffer, vatRate) => {
    const { parseSoberLernerFile } = await import("./sober-lerner-parser");
    return parseSoberLernerFile(buffer);
  },
  // Note: WONGֹ_SHU has a Hebrew diacritical mark (U+05B9) after G
  "WONG\u05B9_SHU": async (buffer, vatRate) => {
    const { parseWongShuFile } = await import("./wong-shu-parser");
    return parseWongShuFile(buffer);
  },
  SUPER_NOVA: async (buffer, vatRate) => {
    const { parseSuperNovaFile } = await import("./super-nova-parser");
    return parseSuperNovaFile(buffer);
  },
  NESPRESSO: async (buffer, vatRate) => {
    const { parseNespressoFile } = await import("./nespresso-parser");
    return parseNespressoFile(buffer);
  },
  TEMPO: async (buffer, vatRate) => {
    const { parseTempoFile } = await import("./tempo-parser");
    return parseTempoFile(buffer);
  },
  TREZ_PAZOS: async (buffer, vatRate) => {
    const { parseTrezPazosFile } = await import("./trez-pazos-parser");
    return parseTrezPazosFile(buffer);
  },
  MITLAND: async (buffer, vatRate) => {
    const { parseMitlandFile } = await import("./mitland-parser");
    return parseMitlandFile(buffer);
  },
};

/**
 * Check if a supplier requires a custom parser
 */
export function requiresCustomParser(supplierCode: string): boolean {
  return supplierCode in CUSTOM_PARSERS;
}

/**
 * Get the custom parser for a supplier
 */
export function getCustomParser(supplierCode: string): CustomParserFn | null {
  return CUSTOM_PARSERS[supplierCode] || null;
}

// Re-export from separate file for backwards compatibility in server-side code.
// Client components should import directly from ./suppliers-with-file-commission
// to avoid pulling in server-side parser dependencies.
export {
  SUPPLIERS_WITH_FILE_COMMISSION,
  hasCommissionFromFile,
} from "./suppliers-with-file-commission";
