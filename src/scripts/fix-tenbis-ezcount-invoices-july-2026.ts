/**
 * One-off CLI: put 10bis's July 2026 franchisee invoices into the client_report
 * slot, where HAAT's and Mishloha's already live.
 *
 * Reut, 2026-08-11: the document she reconciles as "the invoice" is the
 * ezcount tax invoice the FRANCHISEE issues to the platform — not the
 * platform's commission invoice (חשבונית עמלה), and not 10bis's transaction
 * report. For every other platform that invoice is already the client_report:
 *
 *     HAAT       client_report = ezcount 10084
 *     MISHLOCHA  client_report = ezcount 10085
 *     TENBIS     client_report = 21657_20260701_20260731.pdf   ← the report
 *
 * One ezcount sequence serves every platform, so ויני עזריאלי's July numbers
 * run 10082 (10bis) / 10084 (HAAT) / 10085 (Mishloha).
 *
 * 10bis attaches its invoice copy to the same email as the report. All five
 * July copies were typed commission_invoice, collided with 10bis's own
 * commission invoice, and were refused — so the report kept the slot and the
 * invoice was never stored. (Typing fixed in classify-document-type.ts /
 * email-inbound route, same change set.)
 *
 * Each invoice total equals its report total, which is the check Reut runs:
 *     10017  קינג קונג חדרה   ₪25,064.00   report 25,064.10
 *     10056  קינג קונג ביג    ₪29,911.00   report 29,911.00
 *     10062  ויני רגבה        ₪10,974.00   report 10,974.00
 *     10077  קסטרא            ₪19,656.00   report 19,656.00
 *     10082  ויני עזריאלי     ₪30,132.00   report 30,132.00  (ENTITY)
 *
 * 10082 covers the whole Azrieli entity, like the report and the commission
 * invoice before it, so it is attached to BOTH branch rows and each keeps its
 * own share of the amount (19,233.55 / 10,898.45).
 *
 * The transaction report is not deleted — it stays reachable in
 * inbound_review_queue and gmail_sync_log. What changes is which file the
 * client_report row points at, which is what the reconciliation screen serves.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/fix-tenbis-ezcount-invoices-july-2026.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import {
  client,
  clientDocument,
  franchisee,
  inboundReviewQueue,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";

/** ezcount copy → the franchisee row(s) it belongs to. */
const INVOICES: Array<{
  file: string;
  invoiceNumber: string;
  franchisees: string[];
}> = [
  { file: "2026-7-10017_copy.pdf", invoiceNumber: "10017", franchisees: ['קינג קונג חדרה בע"מ'] },
  { file: "2026-7-10056_copy.pdf", invoiceNumber: "10056", franchisees: ['קינג קונג ביג בע"מ'] },
  { file: "2026-7-10062_copy.pdf", invoiceNumber: "10062", franchisees: ['ויני רגבה בע"מ'] },
  { file: "2026-7-10077_copy.pdf", invoiceNumber: "10077", franchisees: ['קסטרא טומאיי בע"מ'] },
  // Entity invoice — both Azrieli branches, each keeping its own share.
  {
    file: "2026-7-10082_copy.pdf",
    invoiceNumber: "10082",
    franchisees: ["ויני עזריאלי חיפה", "נתנזון עזריאלי חיפה"],
  },
];

async function main() {
  const apply = process.argv.includes("--apply");

  const [tenbis] = await database
    .select({ id: client.id })
    .from(client)
    .where(eq(client.code, "TENBIS"));
  if (!tenbis) throw new Error("TENBIS client not found");

  let swapped = 0;

  for (const invoice of INVOICES) {
    const [queued] = await database
      .select({
        id: inboundReviewQueue.id,
        fileUrl: inboundReviewQueue.fileUrl,
        fileSize: inboundReviewQueue.fileSize,
        mimeType: inboundReviewQueue.mimeType,
      })
      .from(inboundReviewQueue)
      .where(eq(inboundReviewQueue.fileName, invoice.file));

    if (!queued?.fileUrl) {
      console.log(`  ✗ ${invoice.file}: not in the review queue with a file`);
      continue;
    }

    for (const name of invoice.franchisees) {
      const [row] = await database
        .select({
          id: clientDocument.id,
          fileName: clientDocument.originalFileName,
          totalAmount: clientDocument.totalAmount,
        })
        .from(clientDocument)
        .innerJoin(franchisee, eq(franchisee.id, clientDocument.franchiseeId))
        .where(
          and(
            eq(clientDocument.clientId, tenbis.id),
            eq(clientDocument.documentType, "client_report"),
            eq(clientDocument.periodMonth, 7),
            eq(clientDocument.periodYear, 2026),
            eq(franchisee.name, name),
          ),
        );

      if (!row) {
        console.log(`  ✗ ${name}: no July client_report row`);
        continue;
      }
      if (row.fileName === invoice.file) {
        console.log(`  = ${name.padEnd(22)} already points at ${invoice.file}`);
        continue;
      }

      console.log(
        `  ${name.padEnd(22)} ₪${String(row.totalAmount).padStart(10)}  ${row.fileName} → ${invoice.file}`,
      );
      swapped++;

      if (!apply) continue;
      await database
        .update(clientDocument)
        .set({
          originalFileName: invoice.file,
          fileUrl: queued.fileUrl,
          fileSize: queued.fileSize,
          mimeType: queued.mimeType ?? "application/pdf",
          invoiceNumber: invoice.invoiceNumber,
          reviewNotes:
            `חשבונית המס שהזכיין הוציא ל-10ביס (ezcount ${invoice.invoiceNumber}) — ` +
            `זהו המסמך שמוצג ומורד, כמו אצל האט ומשלוחה. ` +
            (invoice.franchisees.length > 1
              ? `החשבונית היא ברמת הישות (₪30,132) ומשותפת לשני הסניפים; הסכום כאן הוא החלק של ${name}. `
              : "") +
            `דוח העסקאות של 10ביס נשאר זמין בתור הסקירה. תוקן 2026-08-11.`,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(clientDocument.id, row.id));
    }

    if (apply) {
      await database
        .update(inboundReviewQueue)
        .set({ status: "auto_committed", reviewedAt: new Date() })
        .where(eq(inboundReviewQueue.id, queued.id));
    }
  }

  console.log(
    apply ? `\n✓ ${swapped} row(s) now point at the invoice.` : "\n(dry run — re-run with --apply)",
  );
  process.exit(0);
}

main();
