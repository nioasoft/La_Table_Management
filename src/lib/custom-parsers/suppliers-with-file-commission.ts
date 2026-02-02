/**
 * Suppliers that provide pre-calculated commission in their files.
 *
 * This file is intentionally separated from index.ts to allow client-side
 * components to import it without pulling in server-side parser dependencies.
 *
 * For these suppliers, the commission is extracted from the file itself
 * rather than calculated using the supplier's default commission rate.
 */
export const SUPPLIERS_WITH_FILE_COMMISSION = [
  "MADAG",
  "AVRAHAMI",
  "FANDANGO",
  "KIROSKAI",
  "JUMON",
  "NESPRESSO",
  "MIZRACH_UMAARAV",
  "SOBER_LERNER",
  "MACHALVOT_GAD",
] as const;

/**
 * Check if a supplier provides pre-calculated commission from their file
 */
export function hasCommissionFromFile(supplierCode: string): boolean {
  return SUPPLIERS_WITH_FILE_COMMISSION.includes(
    supplierCode as (typeof SUPPLIERS_WITH_FILE_COMMISSION)[number]
  );
}
