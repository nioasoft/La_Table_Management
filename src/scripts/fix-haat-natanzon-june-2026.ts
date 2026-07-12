/**
 * One-off CLI: repair the June-2026 HAAT documents for the shared-entity
 * pair פט ויני עזריאלי חיפה + נתנזון עזריאלי חיפה (one ח.פ, one ezcount
 * account).
 *
 * IMPORTANT — attribution verified against Tabit totals (2026-07-12), and it
 * is the OPPOSITE of the naive "parked = Natanzon" assumption:
 *   - EasyCount 10079 (₪3,165), auto-committed to VINI  → actually NATANZON
 *     (equals Natanzon's Tabit total exactly; Vini's Tabit is ₪7,575).
 *   - EasyCount 10080 (₪7,710), parked in review        → actually VINI.
 *   - SI266016246 (₪1,298), parked                      → NATANZON
 *     (deterministic: customer number 107143).
 * The invoice-number order flipped vs May — which is why the resolver now
 * parks ALL shared-entity docs without a customer number instead of guessing
 * (see getSharedEntityFranchisees + resolve-franchisee.ts).
 *
 * Steps (order matters — step 1 frees Vini's client_report slot for step 2):
 *   1. Move the committed 10079 client_document from Vini → Natanzon (UPDATE).
 *   2. Commit parked 10080 (queue 9f15c96c) → Vini via processClientDocument.
 *   3. Commit parked SI266016246 (queue 9b04170a) → Natanzon.
 *   4. Mark both queue rows auto_committed.
 *
 * Usage:
 *   npx tsx --env-file=.env src/scripts/fix-haat-natanzon-june-2026.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { clientDocument, inboundReviewQueue } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getClientParser, getInvoiceParser } from "@/lib/client-parsers";
import { processClientDocument } from "@/lib/client-document-processor";

const VINI_ID = "0e2a027a-18bb-4274-af4e-be451799a29b";
const VINI_NAME = "פט ויני עזריאלי חיפה";
const NATANZON_ID = "ab020323-fefe-4543-9a69-16d14dd54b99";
const NATANZON_NAME = "נתנזון עזריאלי חיפה";
const HAAT_CLIENT_ID = "aed8c355-ddc8-47b9-891f-b9420d6b2dd4";

// Committed June client_report currently on Vini — belongs to Natanzon.
const MOVE_GUARD = { expectedTotal: "3165.00" };

const QUEUE_TARGETS: ReadonlyArray<{
  queueId: string;
  documentType: "client_report" | "commission_invoice";
  franchiseeId: string;
  franchiseeName: string;
  note: string;
}> = [
  {
    // EasyCount 10080, ₪7,710 — matches Vini's Tabit (₪7,575).
    queueId: "9f15c96c-68ec-4a53-8338-c663b4ce501d",
    documentType: "client_report",
    franchiseeId: VINI_ID,
    franchiseeName: VINI_NAME,
    note: "one-off recovery: shared-entity, amount matches Vini Tabit (7710≈7575)",
  },
  {
    // SI266016246, ₪1,298 — customer number 107143 → Natanzon (deterministic).
    queueId: "9b04170a-9aa0-405f-a58b-67c1f834cc9a",
    documentType: "commission_invoice",
    franchiseeId: NATANZON_ID,
    franchiseeName: NATANZON_NAME,
    note: "one-off recovery: shared-entity, customer number 107143 → Natanzon",
  },
];

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function moveCommittedReportToNatanzon(apply: boolean): Promise<boolean> {
  console.log(`── Step 1: move committed June client_report Vini → Natanzon ──`);
  const [doc] = await database
    .select()
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.clientId, HAAT_CLIENT_ID),
        eq(clientDocument.franchiseeId, VINI_ID),
        eq(clientDocument.documentType, "client_report"),
        eq(clientDocument.periodMonth, 6),
        eq(clientDocument.periodYear, 2026),
      ),
    )
    .limit(1);

  if (!doc) {
    console.log(`  (no committed Vini client_report found — already moved?)\n`);
    return true;
  }
  console.log(
    `  found   : ${doc.id} "${doc.originalFileName}" total=${doc.totalAmount}`,
  );
  if (doc.totalAmount !== MOVE_GUARD.expectedTotal) {
    console.log(
      `  ✗ ABORT: total ${doc.totalAmount} ≠ expected ${MOVE_GUARD.expectedTotal} — data changed since analysis, re-verify before applying\n`,
    );
    return false;
  }
  console.log(`  → WOULD move to: ${NATANZON_NAME} (${NATANZON_ID})`);
  if (!apply) {
    console.log(`  (dry-run — no changes)\n`);
    return true;
  }
  await database
    .update(clientDocument)
    .set({ franchiseeId: NATANZON_ID, updatedAt: new Date() })
    .where(eq(clientDocument.id, doc.id));
  console.log(`  ✓ moved client_document ${doc.id} to Natanzon\n`);
  return true;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    `\n=== HAAT June-2026 Vini/Natanzon recovery (${apply ? "APPLY" : "DRY-RUN"}) ===\n`,
  );

  const moved = await moveCommittedReportToNatanzon(apply);
  if (!moved) process.exit(1);

  for (const target of QUEUE_TARGETS) {
    const [row] = await database
      .select()
      .from(inboundReviewQueue)
      .where(eq(inboundReviewQueue.id, target.queueId))
      .limit(1);

    if (!row) {
      console.log(`✗ ${target.queueId}: queue row not found — skipping\n`);
      continue;
    }
    console.log(`── ${target.queueId} (${target.documentType}) ──`);
    console.log(`  subject : ${row.emailSubject}`);
    console.log(`  status  : ${row.status}`);
    if (row.status === "auto_committed") {
      console.log(`  already committed — skipping\n`);
      continue;
    }
    if (!row.fileUrl) {
      console.log(`  ✗ no file_url — cannot recover\n`);
      continue;
    }

    const buffer = await downloadBuffer(row.fileUrl);

    // Parse (read-only) to show what would be committed.
    const parser =
      target.documentType === "commission_invoice"
        ? getInvoiceParser("HAAT")
        : getClientParser("HAAT");
    if (parser) {
      try {
        const parsed = await parser(buffer, row.mimeType ?? "application/pdf");
        const d = parsed.data;
        console.log(
          `  parsed  : invoice=${d?.invoiceNumber ?? "?"} total=${d?.totalAmount ?? "?"} commission=${d?.commissionAmount ?? "?"} period=${d?.periodMonth ?? "?"}/${d?.periodYear ?? "?"} issuer="${d?.franchiseeName ?? "?"}"`,
        );
      } catch (err) {
        console.log(`  parse warn: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log(`  → WOULD assign to: ${target.franchiseeName} (${target.franchiseeId})`);

    if (!apply) {
      console.log(`  (dry-run — no changes)\n`);
      continue;
    }

    const result = await processClientDocument({
      buffer,
      fileName: row.fileName ?? "inbound-review.pdf",
      mimeType: row.mimeType ?? "application/pdf",
      clientId: row.clientId ?? HAAT_CLIENT_ID,
      parserCode: "HAAT",
      franchiseeId: target.franchiseeId,
      periodMonth: row.periodMonth ?? 6,
      periodYear: row.periodYear ?? 2026,
      documentType: target.documentType,
      source: "gmail_fetch",
      gmailMessageId: row.gmailMessageId ?? `manual-${row.id}`,
      allowReplace: true,
    });

    if (!result.success || !result.document) {
      console.log(`  ✗ processClientDocument failed: ${result.error ?? "unknown"}\n`);
      continue;
    }

    await database
      .update(inboundReviewQueue)
      .set({
        status: "auto_committed",
        committedClientDocumentId: result.document.id,
        proposedFranchiseeId: target.franchiseeId,
        proposedDocumentType: target.documentType,
        reviewedAt: new Date(),
        reviewNotes: target.note,
        updatedAt: new Date(),
      })
      .where(eq(inboundReviewQueue.id, row.id));

    console.log(`  ✓ committed client_document ${result.document.id}\n`);
  }

  console.log(apply ? "Done (applied)." : "Done (dry-run). Re-run with --apply to commit.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
