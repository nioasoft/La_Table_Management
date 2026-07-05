/**
 * One-off: resolve the 5 overwrite-conflict rows surfaced by the new digest
 * category (2026-07-05). Per-row verdict (see session analysis):
 *
 *   e06fd56b HAAT May  קבלה 20007      → REJECT  (receipt; slot has real inv 10051)
 *   12d467ae HAAT Jun  EasyCount חורב  → REJECT  (duplicate; slot has inv 10052)
 *   1cc46b4a CIBUS May commission Vini → RECOVER (slot is EMPTY — safe commit)
 *   5c2c2aad TENBIS May 500111215      → LEAVE   (two real invoices, one slot — Reut)
 *   9f15c96c HAAT Jun  EasyCount Vini  → LEAVE   (Vini/Natanzon shared-entity — Reut)
 *
 * REJECT = status→rejected + note (no financial data touched, reversible).
 * RECOVER = download blocked file → processClientDocument(allowReplace) → close.
 * LEAVE = untouched, stays in the digest's conflict section for manual review.
 *
 * Usage:
 *   npx tsx scripts/resolve-inbound-conflicts-2026-07-05.ts          # dry-run
 *   npx tsx scripts/resolve-inbound-conflicts-2026-07-05.ts --apply  # commit
 */
import "dotenv/config";
import { database } from "../src/db";
import { client, inboundReviewQueue } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { processClientDocument } from "../src/lib/client-document-processor";

const TODAY = "2026-07-05";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  // Re-fetch the live conflict rows so we act on real ids, not stale ones.
  const rows = await database
    .select()
    .from(inboundReviewQueue)
    .where(eq(inboundReviewQueue.status, "failed"));

  // --- REJECT the two benign rows (matched by id prefix for safety) ---
  const rejectPrefixes = [
    { prefix: "e06fd56b", why: "קבלה — המשבצת מחזיקה את חשבונית 10051 האמיתית (benign, receipt now dropped on arrival)" },
    { prefix: "12d467ae", why: "כפילות של חשבונית 10052 שכבר יושבת במשבצת (benign duplicate)" },
  ];
  for (const rp of rejectPrefixes) {
    const row = rows.find((r) => r.id.startsWith(rp.prefix) && (r.failureReason ?? "").includes("קיים כבר מסמך"));
    if (!row) { console.log(`REJECT ${rp.prefix}: not found / already handled`); continue; }
    console.log(`${apply ? "REJECT" : "WOULD REJECT"} ${row.id.slice(0,8)} "${row.emailSubject}"`);
    if (apply) {
      await database.update(inboundReviewQueue)
        .set({ status: "rejected", reviewNotes: `[resolve-conflicts ${TODAY}] ${rp.why}`, reviewedAt: new Date(), updatedAt: new Date() })
        .where(eq(inboundReviewQueue.id, row.id));
    }
  }

  // --- RECOVER the CIBUS May Vini commission invoice into its (now empty) slot ---
  const rec = rows.find((r) => r.id.startsWith("1cc46b4a") && (r.failureReason ?? "").includes("קיים כבר מסמך"));
  if (!rec) {
    console.log("RECOVER 1cc46b4a: not found / already handled");
  } else if (!rec.fileUrl || !rec.clientId || !rec.proposedFranchiseeId || !rec.periodMonth || !rec.periodYear) {
    console.log("RECOVER 1cc46b4a: missing file/client/franchisee/period — cannot auto-recover");
  } else {
    const [cl] = await database.select({ parserCode: client.parserCode, code: client.code }).from(client).where(eq(client.id, rec.clientId));
    const parserCode = cl?.parserCode || cl?.code || "";
    console.log(`${apply ? "RECOVER" : "WOULD RECOVER"} ${rec.id.slice(0,8)} "${rec.emailSubject}" → ${rec.proposedFranchiseeName} ${rec.periodMonth}/${rec.periodYear} (commission_invoice)`);
    if (apply) {
      const res = await fetch(rec.fileUrl);
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const result = await processClientDocument({
        buffer,
        fileName: rec.fileName ?? "cibus-invoice.pdf",
        mimeType: rec.mimeType ?? "application/pdf",
        clientId: rec.clientId,
        parserCode,
        franchiseeId: rec.proposedFranchiseeId,
        periodMonth: rec.periodMonth,
        periodYear: rec.periodYear,
        documentType: "commission_invoice",
        source: "gmail_fetch",
        gmailMessageId: (rec.gmailMessageId ?? `manual-${rec.id}`).split("#")[0],
        allowReplace: true,
      });
      if (!result.success || !result.document) throw new Error(`processClientDocument failed: ${result.error ?? "unknown"}`);
      console.log(`  → doc ${result.document.id.slice(0,8)} total=${result.document.totalAmount} comm=${result.document.commissionAmount} inv=${result.document.invoiceNumber}`);
      await database.update(inboundReviewQueue)
        .set({ status: "auto_committed", committedClientDocumentId: result.document.id, reviewedAt: new Date(),
               reviewNotes: `[resolve-conflicts ${TODAY}] CIBUS May Vini commission invoice re-committed into its empty slot.`, updatedAt: new Date() })
        .where(eq(inboundReviewQueue.id, rec.id));
    }
  }

  console.log(`\nLEAVE for Reut (manual judgment): TENBIS 500111215 (5c2c2aad) + HAAT-Jun Vini/Natanzon (9f15c96c)`);
  console.log(`done. dry-run=${!apply}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
