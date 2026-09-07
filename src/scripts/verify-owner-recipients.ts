/**
 * Asserts that `ownerRecipients` really reads the contact table.
 *
 * Its failure mode is silence: a broken correlation makes the subquery match
 * nothing, the coalesce falls back to the frozen `franchisee.owners` jsonb, and
 * the royalty screen goes on mailing addresses nobody has edited in months. No
 * error, no type failure, no mocked test can see it — only real rows can. Run
 * this after touching the fragment, the contact table, or the columns it names.
 *
 *   npx dotenv -e .env -- npx tsx src/scripts/verify-owner-recipients.ts
 */
import { and, eq, sql } from "drizzle-orm";

import { ownerRecipients } from "@/data-access/franchisee-owner-recipients";
import { database } from "@/db";
import * as schema from "@/db/schema";

interface Recipient {
  readonly name?: string;
  readonly email?: string;
}

function addresses(value: unknown): string {
  return ((value ?? []) as Recipient[])
    .map((entry) => (entry.email ?? "").trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(", ");
}

async function main(): Promise<void> {
  const rows = await database
    .select({
      id: schema.franchisee.id,
      name: schema.franchisee.name,
      resolved: ownerRecipients,
      legacy: schema.franchisee.owners,
      ownerContacts: sql<string | null>`(
        select string_agg(distinct lower(btrim(oc.email)), ', ')
          from "contact" oc
         where oc.franchisee_id = "franchisee"."id"
           and oc.role = 'owner' and oc.is_active
           and oc.email is not null and btrim(oc.email) <> ''
      )`,
    })
    .from(schema.franchisee)
    .where(eq(schema.franchisee.isActive, true))
    .orderBy(schema.franchisee.name);

  const failures: string[] = [];
  let fromContacts = 0;
  let fromLegacy = 0;
  const changed: string[] = [];
  const noAddress: string[] = [];

  for (const row of rows) {
    const resolved = addresses(row.resolved);
    const expected = (row.ownerContacts ?? "")
      .split(",").map((value) => value.trim()).filter(Boolean).sort().join(", ");

    if (expected) {
      fromContacts++;
      // Every owner contact must be reachable, or the allowlist rejects a send.
      const missing = expected.split(", ").filter((email) => !resolved.includes(email));
      if (missing.length > 0) {
        failures.push(
          `${row.name}: the contact table holds ${expected} but the fragment resolved ${resolved || "(none)"}`,
        );
      }
    } else {
      fromLegacy++;
      if (resolved !== addresses(row.legacy)) {
        failures.push(
          `${row.name}: no owner contacts, so the legacy jsonb should pass through — got ${resolved || "(none)"}`,
        );
      }
    }

    if (resolved !== addresses(row.legacy)) {
      changed.push(`${row.name}\n     now -> ${resolved || "(none)"}\n     was -> ${addresses(row.legacy) || "(none)"}`);
    }
    if (!resolved) noAddress.push(row.name);
  }

  console.log(`${rows.length} active franchisees — ${fromContacts} from the contact table, ${fromLegacy} still on the legacy jsonb.`);
  if (changed.length > 0) {
    console.log(`\nRecipients that change (these were mailed the wrong address until now):`);
    for (const line of changed) console.log(`   ${line}`);
  }
  if (noAddress.length > 0) {
    console.log(`\nNo owner address at all (${noAddress.length}): ${noAddress.join(", ")}`);
  }
  if (failures.length > 0) {
    console.error(`\nFAILED — the fragment is not reading the contact table:`);
    for (const line of failures) console.error(`   ${line}`);
    process.exit(1);
  }
  console.log(`\nOK — every franchisee with owner contacts resolves to them.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
