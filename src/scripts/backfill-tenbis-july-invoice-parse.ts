/**
 * One-off CLI: backfill the parsed fields on the July 2026 10bis invoices
 * recovered by fix-tenbis-invoices-july-2026.ts.
 *
 * That script hand-built the rows and set only the amounts, so
 * `processing_result`, `invoice_number` and `commission_rate` stayed NULL —
 * which is why the site showed the report but no tagged invoice beside it.
 * Every row the pipeline writes carries those fields; a row without them is
 * only half a document.
 *
 * Rather than hand-fill again, this re-runs the REAL parser over each row's
 * stored PDF and copies out what the pipeline would have written. The amounts
 * are left exactly as they are: the Azrieli entity invoice is deliberately
 * split across two franchisees (₪2,334.94 / ₪1,323.06) and must not be reset
 * to the parser's entity-level ₪3,658.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/backfill-tenbis-july-invoice-parse.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { client, clientDocument, franchisee } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { parseTenbisInvoice } from "@/lib/client-parsers/invoice-tenbis-parser";

async function main() {
  const apply = process.argv.includes("--apply");

  const [tenbis] = await database
    .select({ id: client.id })
    .from(client)
    .where(eq(client.code, "TENBIS"));
  if (!tenbis) throw new Error("TENBIS client not found");

  const rows = await database
    .select({
      id: clientDocument.id,
      name: franchisee.name,
      fileUrl: clientDocument.fileUrl,
      fileName: clientDocument.originalFileName,
      totalAmount: clientDocument.totalAmount,
    })
    .from(clientDocument)
    .innerJoin(franchisee, eq(franchisee.id, clientDocument.franchiseeId))
    .where(
      and(
        eq(clientDocument.clientId, tenbis.id),
        eq(clientDocument.documentType, "commission_invoice"),
        eq(clientDocument.periodMonth, 7),
        eq(clientDocument.periodYear, 2026),
        isNull(clientDocument.processingResult),
      ),
    );

  if (rows.length === 0) {
    console.log("✓ nothing to backfill — every July invoice already parsed.");
    process.exit(0);
  }

  console.log(`${rows.length} row(s) missing parsed fields:\n`);

  for (const row of rows) {
    if (!row.fileUrl) {
      console.log(`  ✗ ${row.name}: no file_url, skipping`);
      continue;
    }
    const response = await fetch(row.fileUrl);
    if (!response.ok) {
      console.log(`  ✗ ${row.name}: download failed (${response.status})`);
      continue;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const parsed = await parseTenbisInvoice(buffer, "application/pdf");

    if (!parsed.success || !parsed.data) {
      console.log(`  ✗ ${row.name}: parse failed — ${parsed.errors.join("; ")}`);
      continue;
    }

    // The stored amount wins. For the Azrieli entity invoice it is this
    // franchisee's SHARE, while the parser reports the whole ₪3,658.
    const storedTotal = parseFloat(row.totalAmount ?? "0");
    const commissionRate =
      storedTotal > 0 && parsed.data.commissionRate
        ? parsed.data.commissionRate
        : 0;

    console.log(
      `  ${row.name.padEnd(22)} ₪${storedTotal.toLocaleString("he-IL").padStart(9)}  ` +
        `invoice=${parsed.data.invoiceNumber ?? "—"}  period=${parsed.data.periodMonth}/${parsed.data.periodYear}`,
    );

    if (parsed.data.periodMonth !== 7 || parsed.data.periodYear !== 2026) {
      console.log(
        `     ⚠ parser says ${parsed.data.periodMonth}/${parsed.data.periodYear}, row is 7/2026 — leaving the row where it is, check by hand`,
      );
    }

    if (!apply) continue;

    await database
      .update(clientDocument)
      .set({
        processingResult: {
          ...parsed,
          data: {
            ...parsed.data,
            // Keep the document's own share, not the entity total.
            totalAmount: storedTotal,
            commissionAmount: storedTotal,
            netAmount: storedTotal,
          },
        } as unknown as Record<string, unknown>,
        invoiceNumber: parsed.data.invoiceNumber ?? null,
        commissionRate: commissionRate.toString(),
        allocationNumber: parsed.data.allocationNumber ?? null,
        updatedAt: new Date(),
      })
      .where(eq(clientDocument.id, row.id));
  }

  console.log(apply ? "\n✓ backfilled." : "\n(dry run — re-run with --apply)");
  process.exit(0);
}

main();
