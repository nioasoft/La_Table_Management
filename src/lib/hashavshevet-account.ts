/**
 * Resolve the Hashavshevet "account key" for a client row in an export.
 *
 * Priority (first non-empty wins):
 *   1. Brand-specific override (`hashavshevetByBrand[brandId]`)
 *   2. Global account code (`hashavshevetCode`)
 *   3. Global account name (`hashavshevetName`)
 *   4. Display name (`name`)
 *
 * The per-brand override lets a single client ("GIFT CARD", "LA TABLE", etc.)
 * map to a different Hashavshevet account depending on which brand's franchisee
 * is being exported.
 */

export interface ResolvableClientAccount {
  hashavshevetByBrand?: Record<string, string> | null;
  hashavshevetCode?: string | null;
  hashavshevetName?: string | null;
  name: string;
}

export function resolveClientHashavshevetAccount(
  client: ResolvableClientAccount,
  brandId: string | null | undefined
): string {
  const perBrand =
    brandId && client.hashavshevetByBrand
      ? client.hashavshevetByBrand[brandId]?.trim()
      : "";
  return (
    perBrand ||
    client.hashavshevetCode ||
    client.hashavshevetName ||
    client.name
  );
}

/**
 * Resolve the Hashavshevet "item key" (מפתח פריט) override for a client row.
 *
 * Priority (first non-empty wins):
 *   1. Brand-specific override (`hashavshevetItemKeyByBrand[brandId]`)
 *   2. Global item key (`hashavshevetItemKey`)
 *   3. `null` — no client-level override; the export route falls back to the
 *      franchisee's item key, then the default ("ארוחות").
 *
 * Returns `null` (not a display name) when unset, so callers can apply their
 * own franchisee/default fallback — unlike the account key, which always
 * resolves to a printable value.
 */
export interface ResolvableClientItemKey {
  hashavshevetItemKeyByBrand?: Record<string, string> | null;
  hashavshevetItemKey?: string | null;
}

export function resolveClientHashavshevetItemKey(
  client: ResolvableClientItemKey,
  brandId: string | null | undefined
): string | null {
  const perBrand =
    brandId && client.hashavshevetItemKeyByBrand
      ? client.hashavshevetItemKeyByBrand[brandId]?.trim()
      : "";
  return perBrand || client.hashavshevetItemKey?.trim() || null;
}
