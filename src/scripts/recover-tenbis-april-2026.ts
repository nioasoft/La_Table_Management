/**
 * One-off CLI: recover the 4 real April-2026 10bis monthly reports for
 * קינג קונג חדרה / חורב / ביג and קסטרא טומאיי.
 *
 * Story: the real reports arrived 2026-04-30 21:08-22:46, were saved as
 * auto_approved client_document rows. On 2026-05-10 09:25 a 10bis "הודעת
 * תשלום" PDF arrived for the same franchisee+period+document_type tuple.
 * The processor's dedup-replace step (client-document-processor.ts:248)
 * UPDATE-replaced each row's file_url and processing_result with the
 * payment notification — losing the real report from the DB. The 4 real
 * PDFs are still intact in Vercel Blob; this script reconstructs the rows
 * from those blobs.
 *
 * Going forward the parser-level skipPersist guard (committed 2026-05-10)
 * stops payment notifications from triggering this overwrite path again.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/recover-tenbis-april-2026.ts [--apply]
 *
 * Default is dry-run.
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { randomUUID } from "node:crypto";
import { database } from "@/db";
import { clientDocument } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { parseTenbisFile } from "@/lib/client-parsers/tenbis-parser";

const TENBIS_CLIENT_ID = "e900ca05-41c9-4ef5-b060-ec42a9e6c1ee";
const PERIOD_MONTH = 4;
const PERIOD_YEAR = 2026;

// Mapping of 10bis restaurant prefix-id → our franchisee row.
// Verified by parsing each PDF and reconciling with the names we already
// have for these franchisees in production.
const RECOVERY_TARGETS: Array<{
  tenbisRestaurantId: string;
  franchiseeId: string;
  franchiseeName: string;
}> = [
  {
    tenbisRestaurantId: "6369",
    franchiseeId: "39f939ee-678a-49bd-b7b6-6fecd40a2de9",
    franchiseeName: 'קסטרא טומאיי בע"מ',
  },
  {
    tenbisRestaurantId: "24430",
    franchiseeId: "326aaeda-bed8-4d89-b1bf-d1467b440b61",
    franchiseeName: 'קינג קונג ביג בע"מ',
  },
  {
    tenbisRestaurantId: "26561",
    franchiseeId: "2652525b-ae70-4487-b36c-0990549d55a9",
    franchiseeName: 'קינג קונג חורב בע"מ',
  },
  {
    tenbisRestaurantId: "31986",
    franchiseeId: "18460104-5b08-4801-b15a-d65054e4b4f9",
    franchiseeName: 'קינג קונג חדרה בע"מ',
  },
];

interface BlobItem {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
}

async function findRealReportBlob(
  tenbisRestaurantId: string
): Promise<BlobItem | null> {
  // Lazy import — only available with token at runtime.
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({
    prefix: `documents/client/${TENBIS_CLIENT_ID}/`,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    limit: 1000,
  });
  // Real reports follow `<restaurantId>_YYYYMMDD_YYYYMMDD_<ts>_<rand>.pdf`.
  const periodPrefix = `${tenbisRestaurantId}_${PERIOD_YEAR}${String(PERIOD_MONTH).padStart(2, "0")}01_`;
  const matches = blobs
    .filter((b) =>
      b.pathname
        .replace(`documents/client/${TENBIS_CLIENT_ID}/`, "")
        .startsWith(periodPrefix)
    )
    .sort(
      (a, b) =>
        new Date(b.uploadedAt as unknown as string).getTime() -
        new Date(a.uploadedAt as unknown as string).getTime()
    );
  if (matches.length === 0) return null;
  const m = matches[0];
  return {
    url: m.url,
    pathname: m.pathname,
    size: m.size,
    uploadedAt: m.uploadedAt as unknown as string,
  };
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function main() {
  const apply = process.argv.includes("--apply");

  console.log(
    `\n[recover-tenbis-april-2026] dry-run=${!apply}, period=${PERIOD_MONTH}/${PERIOD_YEAR}\n`
  );

  for (const target of RECOVERY_TARGETS) {
    console.log(`── ${target.franchiseeName} (tenbis #${target.tenbisRestaurantId}) ──`);

    // Don't double-create — bail out if a row for this franchisee+period
    // already exists with the same document_type. Keeps the script safely
    // re-runnable.
    const existing = await database
      .select({ id: clientDocument.id, status: clientDocument.processingStatus })
      .from(clientDocument)
      .where(
        and(
          eq(clientDocument.clientId, TENBIS_CLIENT_ID),
          eq(clientDocument.franchiseeId, target.franchiseeId),
          eq(clientDocument.periodMonth, PERIOD_MONTH),
          eq(clientDocument.periodYear, PERIOD_YEAR),
          eq(clientDocument.documentType, "client_report")
        )
      )
      .limit(1);
    if (existing.length > 0) {
      console.log(
        `  ↳ row already present (${existing[0].id}, status=${existing[0].status}). Skipping.`
      );
      continue;
    }

    const blob = await findRealReportBlob(target.tenbisRestaurantId);
    if (!blob) {
      console.log(
        `  ↳ no orphan blob found matching ${target.tenbisRestaurantId}_2026 04 01_*. Skipping.`
      );
      continue;
    }
    console.log(`  ↳ blob: ${blob.pathname.split("/").pop()} (${blob.size}b)`);

    const buffer = await downloadBuffer(blob.url);
    const result = await parseTenbisFile(buffer, "application/pdf");
    if (!result.success || !result.data) {
      console.log(
        `  ↳ parser FAILED: ${result.errors.join(" | ")}. Skipping.`
      );
      continue;
    }

    const data = result.data;
    if (data.periodMonth !== PERIOD_MONTH || data.periodYear !== PERIOD_YEAR) {
      console.log(
        `  ↳ parser period ${data.periodMonth}/${data.periodYear} ≠ ${PERIOD_MONTH}/${PERIOD_YEAR}. Skipping.`
      );
      continue;
    }

    console.log(
      `  ↳ parsed: total=${data.totalAmount} commission=${data.commissionAmount} (${data.commissionRate}%) net=${data.netAmount}`
    );

    if (!apply) continue;

    const fileName = blob.pathname.split("/").pop() ?? "tenbis-report.pdf";
    const docId = randomUUID();
    await database.insert(clientDocument).values({
      id: docId,
      clientId: TENBIS_CLIENT_ID,
      franchiseeId: target.franchiseeId,
      documentType: "client_report",
      source: "gmail_fetch",
      originalFileName: fileName,
      fileUrl: blob.url,
      fileSize: blob.size,
      mimeType: "application/pdf",
      periodMonth: PERIOD_MONTH,
      periodYear: PERIOD_YEAR,
      processingStatus: "auto_approved",
      processingResult: result as unknown as Record<string, unknown>,
      totalAmount: data.totalAmount.toString(),
      commissionAmount: data.commissionAmount.toString(),
      commissionRate: data.commissionRate.toString(),
      netAmount: data.netAmount.toString(),
      // Synthetic ID: the original gmailMessageId was lost when the
      // payment notification overwrote the row. Use a recovery-tagged
      // value so it doesn't collide with any real Gmail message and the
      // unique index on gmail_message_id stays clean.
      gmailMessageId: `recovered-2026-04-${target.tenbisRestaurantId}`,
      reviewNotes:
        "שוחזר אוטומטית 2026-05-10 — דוח חודשי 04/2026 שנדרס בטעות על ידי הודעת תשלום של תן ביס.",
      updatedAt: new Date(),
    });
    console.log(`  ↳ INSERTED ${docId}`);
  }

  if (!apply) {
    console.log("\nDry-run. Pass --apply to write rows.");
  } else {
    console.log("\nDone.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
