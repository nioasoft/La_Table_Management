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

// Custom parser function type - accepts buffer and optional vatRate
export type CustomParserFn = (
  buffer: Buffer,
  vatRate?: number
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
  TUVIOT_HATZAFON: async (buffer, vatRate) => {
    const { parseTuviotHatzafonFile } = await import("./tuviot-hatzafon-parser");
    return parseTuviotHatzafonFile(buffer);
  },
  MACHALVOT_GAD: async (buffer, vatRate) => {
    const { parseMachlavotGadFile } = await import("./machlavot-gad-parser");
    return parseMachlavotGadFile(buffer);
  },
  EREL_PACKAGING: async (buffer, vatRate) => {
    const { parseArelArizotFile } = await import("./arel-arizot-parser");
    return parseArelArizotFile(buffer);
  },
  PASTA_LA_CASA: async (buffer, vatRate) => {
    const { parsePastaLaCasaFile } = await import("./pasta-la-casa-parser");
    return parsePastaLaCasaFile(buffer, vatRate);
  },
  ALE_ALE: async (buffer, vatRate) => {
    const { parseAleAleFile } = await import("./ale-ale-parser");
    return parseAleAleFile(buffer, vatRate);
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
