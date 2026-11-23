/**
 * One-off CLI: fill `client_document.invoice_number` on 10bis commission
 * invoices whose layout the parser used to miss (Reut 2026-11-23 — King Kong
 * Hadera's October invoice reached Hashavshevet with an empty אסמכתא 2).
 * Re-reads the stored rawText with `extractTenbisInvoiceNumber`; no download.
 *
 * Guard: a row already sent to Hashavshevet WITHOUT a number is locked under
 * its document id (`…|doc:<id>`). Filling the number changes the row key to
 * `…|inv:<number>`, so the send screen would offer it again as "new" while the
 * first send is still booked → a duplicate entry. Such rows are skipped and
 * listed; reject that batch in the system first (Reut deletes it in
 * Hashavshevet, marks "דחיתי"), then rerun and resend.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/backfill-tenbis-invoice-numbers.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { client, clientDocument, franchisee, hashavshevetSentRow } from "@/db/schema";
import { extractTenbisInvoiceNumber } from "@/lib/client-parsers/invoice-tenbis-parser";
import { and, eq, inArray, isNull } from "drizzle-orm";

const EXPORT_TYPE = "client_commission_invoices";

interface Candidate {
  id: string;
  clientId: string;
  franchiseeId: string;
  franchiseeName: string;
  periodMonth: number;
  periodYear: number;
  invoiceNumber: string;
}

async function loadCandidates(): Promise<Candidate[]> {
  const rows = await database
    .select({
      id: clientDocument.id,
      clientId: clientDocument.clientId,
      franchiseeId: clientDocument.franchiseeId,
      franchiseeName: franchisee.name,
      periodMonth: clientDocument.periodMonth,
      periodYear: clientDocument.periodYear,
      processingResult: clientDocument.processingResult,
    })
    .from(clientDocument)
    .innerJoin(client, eq(client.id, clientDocument.clientId))
    .innerJoin(franchisee, eq(franchisee.id, clientDocument.franchiseeId))
    .where(
      and(
        eq(client.code, "TENBIS"),
        eq(clientDocument.documentType, "commission_invoice"),
        isNull(clientDocument.invoiceNumber)
      )
    );

  const out: Candidate[] = [];
  for (const r of rows) {
    const rawText = (r.processingResult as { data?: { rawText?: string } } | null)?.data?.rawText;
    const invoiceNumber = rawText ? extractTenbisInvoiceNumber(rawText) : "";
    if (!invoiceNumber || !r.clientId) continue;
    out.push({ ...r, clientId: r.clientId, invoiceNumber });
  }
  return out.sort((a, b) => a.periodYear - b.periodYear || a.periodMonth - b.periodMonth);
}

/** Row keys of documents already sent without a number (see the guard above). */
async function lockedDocKeys(candidates: Candidate[]): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const keys = candidates.map((c) => `${c.clientId}|${c.franchiseeId}|doc:${c.id}`);
  const locked = await database
    .select({ rowKey: hashavshevetSentRow.rowKey })
    .from(hashavshevetSentRow)
    .where(
      and(
        eq(hashavshevetSentRow.exportType, EXPORT_TYPE),
        inArray(hashavshevetSentRow.rowKey, keys),
        isNull(hashavshevetSentRow.unlockedAt)
      )
    );
  return new Set(locked.map((l) => l.rowKey));
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const candidates = await loadCandidates();
  const locked = await lockedDocKeys(candidates);

  let updated = 0;
  const skipped: Candidate[] = [];
  for (const c of candidates) {
    const label = `${c.periodYear}-${String(c.periodMonth).padStart(2, "0")} ${c.franchiseeName}`;
    if (locked.has(`${c.clientId}|${c.franchiseeId}|doc:${c.id}`)) {
      skipped.push(c);
      console.log(`  SKIP  ${label} ← ${c.invoiceNumber} (already sent to Hashavshevet without a number)`);
      continue;
    }
    console.log(`  ${apply ? "SET " : "WOULD"} ${label} ← ${c.invoiceNumber}`);
    if (!apply) continue;
    await database
      .update(clientDocument)
      .set({ invoiceNumber: c.invoiceNumber, updatedAt: new Date() })
      .where(and(eq(clientDocument.id, c.id), isNull(clientDocument.invoiceNumber)));
    updated++;
  }

  console.log(
    apply
      ? `\nUpdated ${updated} rows; skipped ${skipped.length} sent row(s).`
      : `\nDry-run: ${candidates.length - skipped.length} rows would be updated, ${skipped.length} skipped. Pass --apply to write.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
