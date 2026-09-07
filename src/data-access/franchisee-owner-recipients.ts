import { sql } from "drizzle-orm";

import type { FranchiseeOwner } from "@/db/schema";

/**
 * The franchisee's owners as the franchisee card holds them today.
 *
 * `franchisee.owners` is a legacy jsonb that nothing writes any more — it was
 * copied once into the `contact` table by migrate-legacy-contacts.ts and has
 * been frozen ever since, so a royalty screen reading it sends to whatever
 * address was true on migration day. The contact table is the live source, and
 * the jsonb only fills the gap for a franchisee that never got contact rows —
 * the same contact-first-then-legacy order the franchisee contacts export uses.
 *
 * A correlated subquery rather than a join: a franchisee with three owners must
 * not turn one billing row into three.
 *
 * Written as literal SQL, not drizzle column interpolation, on purpose. Drizzle
 * omits table qualifiers when the outer select has a single table, which turned
 * `contact.franchisee_id = franchisee.id` into `"franchisee_id" = "id"` — both
 * resolved against `contact`, matching nothing, and the coalesce then fell back
 * to the stale jsonb without erroring. The alias and the explicit
 * `"franchisee"."id"` keep the correlation regardless of the outer shape; the
 * cost is that a column rename here is caught by verify-owner-recipients.ts
 * rather than by the compiler.
 *
 * The outer query must therefore have `franchisee` in its FROM, unaliased.
 */
export const ownerRecipients = sql<FranchiseeOwner[] | null>`coalesce(
  (select jsonb_agg(
            jsonb_build_object(
              'name', oc.name,
              'phone', coalesce(oc.phone, ''),
              'email', oc.email,
              'ownershipPercentage',
                coalesce(oc.ownership_percentage::numeric, 0)
            )
            order by oc.is_primary desc, oc.name)
     from "contact" oc
    where oc.franchisee_id = "franchisee"."id"
      and oc.role = 'owner'
      and oc.is_active
      and oc.email is not null
      and btrim(oc.email) <> ''),
  "franchisee"."owners"
)`;
