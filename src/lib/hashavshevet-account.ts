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
