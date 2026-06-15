/**
 * One-off CLI: backfill `client_document.invoice_number` for existing
 * HAAT/MISHLOCHA/CIBUS rows whose parsers extracted the number into the
 * line-item description but never surfaced it on `data.invoiceNumber`.
 *
 * Bug fix landed 2026-05-10; this script repairs the historical records.
 *
 * Strategy:
 *   - Find rows where invoice_number IS NULL and processing_result has a
 *     parsed number we can extract (line item description like
 *     "חשבונית מס 10049" OR rawText with "חשבונית מס מספר NNN").
 *   - UPDATE invoice_number on the row.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/backfill-invoice-numbers.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { client, clientDocument } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";

interface Candidate {
  id: string;
  clientCode: string;
  rawText: string | null;
  lineItemDescriptions: string[];
}

const TARGET_CLIENT_CODES = ["HAAT", "MISHLOCHA", "CIBUS"];

function extractInvoiceNumber(c: Candidate): string | null {
  // Pattern 1: rawText "חשבונית מס מספר 10049"
  if (c.rawText) {
    const m = c.rawText.match(/חשבונית\s+מס\s+מספר\s+(\d+)/);
    if (m) return m[1];
    // HAAT "חשבונית מס מרכזת SI266013293" — alphanumeric, glued in visual-RTL.
    const si = c.rawText.match(/SI\d{6,}/i);
    if (si) return si[0].toUpperCase();
  }
  // Pattern 2: line item description "חשבונית מס 10049" or "חשבונית מס מרכזת 10049"
  for (const d of c.lineItemDescriptions) {
    const m = d.match(/חשבונית\s+מס(?:\s+מרכזת)?\s+(\d+)/);
    if (m) return m[1];
  }
  return null;
}

async function main() {
  const apply = process.argv.includes("--apply");

  // Resolve the client IDs for the target codes.
  const clientRows = await database
    .select({ id: client.id, code: client.code })
    .from(client)
    .where(inArray(client.code, TARGET_CLIENT_CODES));

  const codeById = new Map(clientRows.map((c) => [c.id, c.code]));
  const targetIds = clientRows.map((c) => c.id);

  if (targetIds.length === 0) {
    console.log("No matching clients found. Exiting.");
    return;
  }

  // Fetch all rows with no invoice_number where extraction is plausible.
  const rows = await database
    .select({
      id: clientDocument.id,
      clientId: clientDocument.clientId,
      processingResult: clientDocument.processingResult,
    })
    .from(clientDocument)
    .where(
      and(
        inArray(clientDocument.clientId, targetIds),
        isNull(clientDocument.invoiceNumber)
      )
    );

  console.log(
    `Found ${rows.length} rows without invoice_number (HAAT/MISHLOCHA/CIBUS).\n`
  );

  let extracted = 0;
  let updated = 0;
  for (const row of rows) {
    const pr = row.processingResult as
      | { data?: { rawText?: string; lineItems?: Array<{ description?: string }> } }
      | null;
    const candidate: Candidate = {
      id: row.id,
      clientCode: codeById.get(row.clientId ?? "") ?? "?",
      rawText: pr?.data?.rawText ?? null,
      lineItemDescriptions:
        pr?.data?.lineItems?.map((li) => li.description ?? "").filter(Boolean) ??
        [],
    };

    const extractedNumber = extractInvoiceNumber(candidate);
    if (!extractedNumber) continue;
    extracted++;

    if (!apply) {
      console.log(`  ${candidate.clientCode.padEnd(10)} ${row.id} ← ${extractedNumber}`);
      continue;
    }

    await database
      .update(clientDocument)
      .set({ invoiceNumber: extractedNumber, updatedAt: new Date() })
      .where(eq(clientDocument.id, row.id));
    updated++;
  }

  if (apply) {
    console.log(`\nUpdated ${updated} rows.`);
  } else {
    console.log(
      `\nDry-run: ${extracted} rows would be updated. Pass --apply to write.`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
