/**
 * Backfill `inbound_review_queue.parsed_data` for rows that predate it.
 *
 * `parsedData` was hardcoded to null when the queue was introduced, so the
 * amount and document number — often the ONLY fields distinguishing two
 * otherwise-identical parked rows (HAAT relays two byte-identical EasyCount
 * invoices a month for the Azrieli pair) — were never stored. New rows get
 * them at write time; this fills in the open ones so they are actionable now.
 *
 * Read-mostly: only touches rows where parsed_data IS NULL and a file exists.
 *
 * Usage:
 *   npx tsx scripts/backfill-review-queue-amounts.ts [--days 30] [--apply]
 */
import "dotenv/config";
import { database } from "../src/db";
import { inboundReviewQueue } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getClientParser, getInvoiceParser } from "../src/lib/client-parsers";

const apply = process.argv.includes("--apply");
const daysArg = process.argv.indexOf("--days");
const days = daysArg > -1 ? parseInt(process.argv[daysArg + 1], 10) : 30;

const rows = ((await database.execute(
  sql.raw(`SELECT id, client_code, proposed_document_type, file_url, file_name,
                  mime_type, status, email_subject
           FROM inbound_review_queue
           WHERE parsed_data IS NULL AND file_url IS NOT NULL
             AND status IN ('failed','needs_review')
             AND created_at > now() - interval '${days} days'
           ORDER BY created_at DESC`)
)).rows ?? []) as any[];

console.log(`${rows.length} candidate row(s)${apply ? "" : "  (dry run — pass --apply to write)"}\n`);

let filled = 0;
for (const r of rows) {
  const parser =
    r.proposed_document_type === "commission_invoice"
      ? getInvoiceParser(r.client_code)
      : getClientParser(r.client_code);
  if (!parser) {
    console.log(`  skip  ${r.client_code} — no parser  (${r.file_name})`);
    continue;
  }
  try {
    const res = await fetch(r.file_url);
    if (!res.ok) {
      console.log(`  skip  ${r.client_code} — blob ${res.status}  (${r.file_name})`);
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const parsed = await parser(buffer, r.mime_type ?? "application/pdf");
    if (!parsed.success || !parsed.data) {
      console.log(`  skip  ${r.client_code} — parse failed  (${r.file_name})`);
      continue;
    }
    const parsedData = {
      totalAmount:
        parsed.data.totalAmount != null ? String(parsed.data.totalAmount) : null,
      invoiceNumber: parsed.data.invoiceNumber ?? null,
    };
    if (!parsedData.totalAmount && !parsedData.invoiceNumber) {
      console.log(`  skip  ${r.client_code} — nothing extracted  (${r.file_name})`);
      continue;
    }
    console.log(
      `  fill  ${String(r.client_code).padEnd(10)} ${String(parsedData.totalAmount ?? "—").padStart(11)}  #${parsedData.invoiceNumber ?? "—"}  ${String(r.email_subject).slice(0, 42)}`
    );
    if (apply) {
      await database
        .update(inboundReviewQueue)
        .set({ parsedData, updatedAt: new Date() })
        .where(eq(inboundReviewQueue.id, r.id));
    }
    filled++;
  } catch (err) {
    console.log(`  skip  ${r.client_code} — ${(err as Error).message}  (${r.file_name})`);
  }
}

console.log(`\n${filled} row(s) ${apply ? "updated" : "would be updated"}`);
process.exit(0);
