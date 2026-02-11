/**
 * Business ID normalization utilities for Israeli business IDs
 *
 * Israeli business IDs can appear in various formats:
 * - "123456789" (plain digits)
 * - "123456789-0" (with check digit)
 * - "12345678" (8 digits with leading zero removed)
 * - "012345678" (with leading zero)
 *
 * This utility normalizes them to a canonical form for comparison.
 */

/**
 * Normalize a business ID to a canonical form for comparison.
 * Removes all non-digit characters and leading zeros.
 *
 * @param id - The business ID to normalize (can be null or undefined)
 * @returns Normalized business ID (digits only, no leading zeros) or null if invalid
 *
 * @example
 * normalizeBusinessId("123456789-0") // "123456789"
 * normalizeBusinessId("012345678")   // "12345678"
 * normalizeBusinessId("  123456789  ") // "123456789"
 * normalizeBusinessId("")            // null
 * normalizeBusinessId(null)          // null
 */
export function normalizeBusinessId(id: string | null | undefined): string | null {
  if (!id) return null;

  const trimmed = id.trim();
  if (trimmed === '') return null;

  // Strip check digit: everything after the first dash (e.g., "123456789-0" → "123456789")
  const withoutCheckDigit = trimmed.split('-')[0];

  // Remove all non-digit characters (spaces, etc.)
  const digitsOnly = withoutCheckDigit.replace(/\D/g, '');
  if (digitsOnly.length === 0) return null;

  // Remove leading zeros, but keep at least one digit
  return digitsOnly.replace(/^0+/, '') || '0';
}

/**
 * Check if two business IDs match (after normalization).
 *
 * @param id1 - First business ID
 * @param id2 - Second business ID
 * @returns True if the IDs match after normalization
 *
 * @example
 * businessIdsMatch("123456789-0", "123456789") // true
 * businessIdsMatch("012345678", "12345678")    // true
 * businessIdsMatch("123456789", "987654321")   // false
 */
export function businessIdsMatch(id1: string | null | undefined, id2: string | null | undefined): boolean {
  const normalized1 = normalizeBusinessId(id1);
  const normalized2 = normalizeBusinessId(id2);

  if (normalized1 === null || normalized2 === null) return false;

  return normalized1 === normalized2;
}

/**
 * Create a normalized lookup map from business IDs to values.
 * Useful for building companyId maps with normalized keys.
 *
 * @param entries - Array of [businessId, value] tuples
 * @returns Map with normalized business IDs as keys
 *
 * @example
 * const map = createNormalizedBusinessIdMap([
 *   ["123456789-0", franchisee1],
 *   ["987654321", franchisee2]
 * ]);
 * map.get("123456789") // franchisee1
 * map.get("123456789-0") // franchisee1 (normalized key lookup)
 */
export function createNormalizedBusinessIdMap<T>(entries: Array<[string, T]>): Map<string, T> {
  const map = new Map<string, T>();

  for (const [businessId, value] of entries) {
    const normalized = normalizeBusinessId(businessId);
    if (normalized !== null) {
      map.set(normalized, value);
    }
  }

  return map;
}
