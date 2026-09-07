/**
 * Reopens one royalty month for editing: every approved row goes back to draft
 * so discounts and corrections can be made again. A row already carried into a
 * Hashavshevet batch is invoiced and is left alone — the script refuses rather
 * than reopening a month that was partly billed out.
 *
 * Usage: npx tsx src/scripts/reopen-billing-period.ts <year> <month> [--apply]
 */
import { and, eq, inArray, isNull } from "drizzle-orm";

import { database } from "@/db";
import * as schema from "@/db/schema";

async function main(): Promise<void> {
  const year = Number(process.argv[2]);
  const month = Number(process.argv[3]);
  const apply = process.argv.includes("--apply");
  if (!Number.isInteger(year) || !(month >= 1 && month <= 12)) {
    throw new Error("usage: reopen-billing-period <year> <month> [--apply]");
  }

  const rows = await database
    .select({
      id: schema.franchiseeBilling.id,
      name: schema.franchisee.name,
      status: schema.franchiseeBilling.status,
      total: schema.franchiseeBilling.total,
      royaltyExportBatchId: schema.franchiseeBilling.royaltyExportBatchId,
      marketingExportBatchId: schema.franchiseeBilling.marketingExportBatchId,
    })
    .from(schema.franchiseeBilling)
    .innerJoin(
      schema.franchisee,
      eq(schema.franchiseeBilling.franchiseeId, schema.franchisee.id),
    )
    .where(
      and(
        eq(schema.franchiseeBilling.periodYear, year),
        eq(schema.franchiseeBilling.periodMonth, month),
      ),
    );

  const approved = rows.filter((row) => row.status === "approved");
  const isExported = (row: (typeof rows)[number]) =>
    row.royaltyExportBatchId !== null || row.marketingExportBatchId !== null;
  const exported = approved.filter(isExported);
  const reopenable = approved.filter((row) => !isExported(row));
  console.log(
    `${year}-${String(month).padStart(2, "0")}: ${rows.length} rows, ${approved.length} approved`,
  );
  for (const row of reopenable) console.log(` reopen  ${row.name} (₪${row.total})`);
  // Invoiced rows stay locked, but they must not block the rest of the month.
  for (const row of exported) console.log(` keep    ${row.name} — exported`);
  if (reopenable.length === 0) {
    console.log("nothing to reopen — the month is already editable");
    return;
  }
  if (!apply) {
    console.log("dry run — pass --apply to reopen");
    return;
  }
  const reopened = await database
    .update(schema.franchiseeBilling)
    .set({ status: "draft", approvedAt: null, approvedBy: null })
    .where(
      and(
        inArray(
          schema.franchiseeBilling.id,
          reopenable.map((row) => row.id),
        ),
        isNull(schema.franchiseeBilling.royaltyExportBatchId),
        isNull(schema.franchiseeBilling.marketingExportBatchId),
      ),
    )
    .returning({ id: schema.franchiseeBilling.id });
  console.log(`reopened ${reopened.length} rows`);
}

void main().then(() => process.exit(0));
