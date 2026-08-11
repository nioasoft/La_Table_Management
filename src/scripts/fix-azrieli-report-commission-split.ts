/**
 * One-off CLI: split the Azrieli entity's July 2026 10bis report COMMISSION
 * across its two branches.
 *
 * fix-azrieli-entity-july-2026.ts split the report's sales total but left the
 * commission column alone, so the entity figure (₪3,658.04) stayed whole on
 * נתנזון's row and ויני עזריאלי's new row got none at all.
 *
 * That matters because of the check Reut runs (2026-08-11): a 10bis invoice
 * must equal the report's commission for the same branch. It holds to within
 * agorot everywhere else —
 *
 *     ויני רגבה        report 1,294.57   invoice 1,295.00
 *     קינג קונג ביג    report 3,491.09   invoice 3,490.99
 *     קינג קונג חדרה   report 3,066.80   invoice 3,067.00
 *     קסטרא            report 2,241.39   invoice 2,241.00
 *
 * — and the two Azrieli rows were the only ones that failed it, purely as an
 * artefact of the earlier fix.
 *
 * The commission is split by the SAME sales ratio already used for the report
 * total and for the entity invoice (400183172, ₪3,658), so all three stay
 * consistent with each other:
 *     ויני עזריאלי   19,233.55 / 30,132 = 63.83%
 *     נתנזון         10,898.45 / 30,132 = 36.17%
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/fix-azrieli-report-commission-split.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { client, clientDocument, franchisee } from "@/db/schema";
import { and, eq } from "drizzle-orm";

const ENTITY_COMMISSION = 3658.04;
const REPORT_TOTAL = 30132;
const SPLIT = [
  { name: "ויני עזריאלי חיפה", share: 19233.55 },
  { name: "נתנזון עזריאלי חיפה", share: 10898.45 },
];

const round2 = (n: number): number => Math.round(n * 100) / 100;

async function main() {
  const apply = process.argv.includes("--apply");

  const [tenbis] = await database
    .select({ id: client.id })
    .from(client)
    .where(eq(client.code, "TENBIS"));
  if (!tenbis) throw new Error("TENBIS client not found");

  let allocated = 0;
  for (let i = 0; i < SPLIT.length; i++) {
    const part = SPLIT[i];
    const commission =
      i === SPLIT.length - 1
        ? round2(ENTITY_COMMISSION - allocated)
        : round2((ENTITY_COMMISSION * part.share) / REPORT_TOTAL);
    allocated = round2(allocated + commission);

    const [row] = await database
      .select({
        id: clientDocument.id,
        totalAmount: clientDocument.totalAmount,
        commissionAmount: clientDocument.commissionAmount,
      })
      .from(clientDocument)
      .innerJoin(franchisee, eq(franchisee.id, clientDocument.franchiseeId))
      .where(
        and(
          eq(clientDocument.clientId, tenbis.id),
          eq(clientDocument.documentType, "client_report"),
          eq(clientDocument.periodMonth, 7),
          eq(clientDocument.periodYear, 2026),
          eq(franchisee.name, part.name),
        ),
      );

    if (!row) {
      console.log(`  ✗ ${part.name}: no July report row`);
      continue;
    }

    const total = parseFloat(row.totalAmount ?? "0");
    console.log(
      `  ${part.name.padEnd(22)} commission ${String(row.commissionAmount ?? "—").padStart(9)} → ${commission}  (net ${round2(total - commission)})`,
    );

    if (!apply) continue;
    await database
      .update(clientDocument)
      .set({
        commissionAmount: commission.toString(),
        commissionRate: (
          Math.round((commission / total) * 10000) / 100
        ).toString(),
        netAmount: round2(total - commission).toString(),
        updatedAt: new Date(),
      })
      .where(eq(clientDocument.id, row.id));
  }

  console.log(apply ? "\n✓ updated." : "\n(dry run — re-run with --apply)");
  process.exit(0);
}

main();
