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

// Registry of custom parsers by supplier code
export const CUSTOM_PARSERS: Record<
  string,
  (buffer: Buffer) => Promise<import("../file-processor").FileProcessingResult>
> = {
  MADAG: async (buffer) => {
    const { parseMadagFile } = await import("./madag-parser");
    return parseMadagFile(buffer);
  },
  AVRAHAMI: async (buffer) => {
    const { parseAvrahamiFile } = await import("./avrahami-parser");
    return parseAvrahamiFile(buffer);
  },
  YAAKOV_AGENCIES: async (buffer) => {
    const { parseYaakovAgenciesFile } = await import("./yaakov-agencies-parser");
    return parseYaakovAgenciesFile(buffer);
  },
  MOR_BRIUT: async (buffer) => {
    const { parseMorBriutFile } = await import("./mor-briut-parser");
    return parseMorBriutFile(buffer);
  },
  UNICO: async (buffer) => {
    const { parseUnikoFile } = await import("./uniko-parser");
    return parseUnikoFile(buffer);
  },
  TUVIOT_HATZAFON: async (buffer) => {
    const { parseTuviotHatzafonFile } = await import("./tuviot-hatzafon-parser");
    return parseTuviotHatzafonFile(buffer);
  },
  MACHALVOT_GAD: async (buffer) => {
    const { parseMachlavotGadFile } = await import("./machlavot-gad-parser");
    return parseMachlavotGadFile(buffer);
  },
  EREL_PACKAGING: async (buffer) => {
    const { parseArelArizotFile } = await import("./arel-arizot-parser");
    return parseArelArizotFile(buffer);
  },
  PASTA_LA_CASA: async (buffer) => {
    const { parsePastaLaCasaFile } = await import("./pasta-la-casa-parser");
    return parsePastaLaCasaFile(buffer);
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
export function getCustomParser(
  supplierCode: string
): ((buffer: Buffer) => Promise<import("../file-processor").FileProcessingResult>) | null {
  return CUSTOM_PARSERS[supplierCode] || null;
}
