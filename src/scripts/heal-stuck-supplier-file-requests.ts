/**
 * One-off CLI: close supplier file_requests whose file has already been
 * uploaded via the admin path (supplier_file_upload).
 *
 * Background: until 2026-05-14, the upload-reminders cron's self-heal only
 * inspected the public-link table (uploaded_file). When Reut uploaded a
 * supplier file via /admin/supplier-files, the file_request stayed in
 * status=sent + submitted_at=NULL, and the cron sent reminders every 7 days
 * + supplier escalations to her, indefinitely. Affected 30+ suppliers on
 * the 2026-05-14 morning run.
 *
 * This script does what the new self-heal code does, but for the rows that
 * already accumulated reminders before the fix is deployed. Safe to re-run.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/heal-stuck-supplier-file-requests.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { fileRequest, supplierFileUpload, supplier } from "@/db/schema";
import { and, eq, or, inArray, gte, isNull } from "drizzle-orm";
import { getPeriodByKey } from "@/lib/settlement-periods";
import { formatDateAsLocal } from "@/lib/date-utils";
import { updateFileRequestStatus } from "@/data-access/fileRequests";

interface Candidate {
  fileRequestId: string;
  supplierName: string;
  periodKey: string;
  uploadedAt: Date;
}

async function findStuck(): Promise<Candidate[]> {
  // All open supplier settlement requests
  const openRequests = await database
    .select({
      id: fileRequest.id,
      entityId: fileRequest.entityId,
      metadata: fileRequest.metadata,
      createdAt: fileRequest.createdAt,
      supplierName: supplier.name,
    })
    .from(fileRequest)
    .leftJoin(supplier, eq(supplier.id, fileRequest.entityId))
    .where(
      and(
        eq(fileRequest.entityType, "supplier"),
        eq(fileRequest.documentType, "settlement_report"),
        or(eq(fileRequest.status, "sent"), eq(fileRequest.status, "in_progress")),
        isNull(fileRequest.submittedAt)
      )
    );

  const matches: Candidate[] = [];
  for (const req of openRequests) {
    const meta = req.metadata as Record<string, unknown> | null;
    const periodKey = meta?.periodKey as string | undefined;
    if (!periodKey) continue;

    const periodInfo = getPeriodByKey(periodKey);
    if (!periodInfo) continue;

    const periodStart = formatDateAsLocal(periodInfo.startDate);
    const periodEnd = formatDateAsLocal(periodInfo.endDate);

    // Mirror the cron's self-heal window
    const earliest = new Date(req.createdAt);
    earliest.setDate(earliest.getDate() - 60);

    const uploads = await database
      .select({ createdAt: supplierFileUpload.createdAt })
      .from(supplierFileUpload)
      .where(
        and(
          eq(supplierFileUpload.supplierId, req.entityId),
          eq(supplierFileUpload.periodStartDate, periodStart),
          eq(supplierFileUpload.periodEndDate, periodEnd),
          gte(supplierFileUpload.createdAt, earliest),
          inArray(supplierFileUpload.processingStatus, ["approved", "auto_approved"])
        )
      )
      .orderBy(supplierFileUpload.createdAt)
      .limit(1);

    if (uploads.length === 0) continue;

    matches.push({
      fileRequestId: req.id,
      supplierName: req.supplierName ?? "?",
      periodKey,
      uploadedAt: uploads[0].createdAt,
    });
  }

  return matches;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const candidates = await findStuck();
  console.log(`\nFound ${candidates.length} stuck supplier file_requests with matching uploads:\n`);
  for (const c of candidates) {
    console.log(
      `  ${c.fileRequestId.slice(0, 8)}  ${c.supplierName.padEnd(30)} ${c.periodKey.padEnd(8)}  uploaded ${c.uploadedAt.toISOString().slice(0, 19)}`
    );
  }

  if (!apply) {
    console.log("\n(dry run — re-run with --apply to mark these as submitted)");
    process.exit(0);
  }

  let closed = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      await updateFileRequestStatus(c.fileRequestId, "submitted", {
        submittedAt: c.uploadedAt,
      });
      closed++;
    } catch (err) {
      failed++;
      console.error(`Failed for ${c.fileRequestId}:`, err);
    }
  }

  console.log(`\nDone — closed=${closed}, failed=${failed}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
