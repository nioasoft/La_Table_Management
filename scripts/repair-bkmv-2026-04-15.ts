/**
 * One-off repair script for BKMV file requests created on 2026-04-15 that
 * never had emails sent due to a missing email_template_id.
 *
 * Background:
 * - The bkmv-requests cron created 19 file_request rows with
 *   document_type='bkmv', status='pending', email_template_id=null.
 * - sendFileRequestEmail returned { success: false, error: "No email template
 *   specified" }, which createFileRequest swallowed silently. The cron logged
 *   "emails_sent: 19" while 0 emails actually went out. Upload links expired
 *   on 2026-04-29 without anyone receiving the link.
 * - The code bugs are fixed in:
 *     - src/app/api/cron/bkmv-requests/route.ts (resolves bkmv_request template)
 *     - src/data-access/fileRequests.ts (throws on send failure)
 *
 * What this script does for each of the 19 stranded requests:
 *   1. Sets file_request.email_template_id to the bkmv_request template UUID
 *   2. Extends file_request.expires_at and upload_link.expires_at to 2026-05-14
 *   3. Ensures upload_link.status is 'active'
 *   4. Calls sendFileRequestEmail() — which on success sets status='sent', sent_at=NOW()
 *
 * Usage:
 *   npx tsx scripts/repair-bkmv-2026-04-15.ts -- --dry-run
 *   npx tsx scripts/repair-bkmv-2026-04-15.ts
 *
 * Idempotent: rows already marked status='sent' are skipped.
 */

import "dotenv/config";
import { database } from "../src/db";
import { fileRequest, uploadLink } from "../src/db/schema";
import { and, eq, gte, lt } from "drizzle-orm";
import { sendFileRequestEmail } from "../src/data-access/fileRequests";
import { getEmailTemplateByCode } from "../src/data-access/emailTemplates";

const NEW_EXPIRY = new Date("2026-05-14T23:59:59.000Z");
const WINDOW_START = new Date("2026-04-15T00:00:00.000Z");
const WINDOW_END = new Date("2026-04-16T00:00:00.000Z");

interface RepairResult {
  total: number;
  alreadySent: number;
  repaired: number;
  failed: number;
  errors: { fileRequestId: string; recipient: string; error: string }[];
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`[repair-bkmv] dryRun=${dryRun}`);

  const template = await getEmailTemplateByCode("bkmv_request");
  if (!template) {
    throw new Error('Email template "bkmv_request" not found in DB');
  }
  console.log(`[repair-bkmv] resolved template ${template.code} -> ${template.id}`);

  const stranded = await database
    .select()
    .from(fileRequest)
    .where(
      and(
        eq(fileRequest.entityType, "franchisee"),
        eq(fileRequest.documentType, "bkmv"),
        gte(fileRequest.createdAt, WINDOW_START),
        lt(fileRequest.createdAt, WINDOW_END)
      )
    );

  const result: RepairResult = {
    total: stranded.length,
    alreadySent: 0,
    repaired: 0,
    failed: 0,
    errors: [],
  };

  console.log(`[repair-bkmv] found ${stranded.length} candidate file_requests`);

  for (const fr of stranded) {
    if (fr.status === "sent" || fr.status === "submitted") {
      result.alreadySent++;
      console.log(`  - SKIP (${fr.status}) ${fr.id} ${fr.recipientEmail}`);
      continue;
    }

    if (fr.status !== "pending") {
      console.log(
        `  - SKIP (status=${fr.status}, not pending) ${fr.id} ${fr.recipientEmail}`
      );
      continue;
    }

    if (dryRun) {
      console.log(
        `  - WOULD REPAIR ${fr.id} ${fr.recipientEmail} (uploadLink=${fr.uploadLinkId})`
      );
      continue;
    }

    try {
      // 1. Attach template + extend file_request expiry
      await database
        .update(fileRequest)
        .set({
          emailTemplateId: template.id,
          expiresAt: NEW_EXPIRY,
          updatedAt: new Date(),
        })
        .where(eq(fileRequest.id, fr.id));

      // 2. Extend upload_link expiry + ensure active
      if (fr.uploadLinkId) {
        await database
          .update(uploadLink)
          .set({
            expiresAt: NEW_EXPIRY,
            status: "active",
            updatedAt: new Date(),
          })
          .where(eq(uploadLink.id, fr.uploadLinkId));
      }

      // 3. Send email — sendFileRequestEmail will set status='sent' and sent_at=NOW() on success
      const sendResult = await sendFileRequestEmail({ fileRequestId: fr.id });

      if (sendResult.success) {
        result.repaired++;
        console.log(
          `  - SENT ${fr.id} -> ${fr.recipientEmail} (messageId=${sendResult.messageId ?? "n/a"})`
        );
      } else {
        result.failed++;
        result.errors.push({
          fileRequestId: fr.id,
          recipient: fr.recipientEmail,
          error: sendResult.error ?? "unknown",
        });
        console.error(
          `  - FAIL ${fr.id} -> ${fr.recipientEmail}: ${sendResult.error}`
        );
      }
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({
        fileRequestId: fr.id,
        recipient: fr.recipientEmail,
        error: message,
      });
      console.error(`  - FAIL ${fr.id} -> ${fr.recipientEmail}: ${message}`);
    }
  }

  console.log("\n[repair-bkmv] summary:");
  console.log(`  total candidates : ${result.total}`);
  console.log(`  already sent     : ${result.alreadySent}`);
  console.log(`  repaired now     : ${result.repaired}`);
  console.log(`  failed           : ${result.failed}`);
  if (result.errors.length > 0) {
    console.log("  errors:");
    for (const e of result.errors) {
      console.log(`    - ${e.fileRequestId} (${e.recipient}): ${e.error}`);
    }
  }

  if (result.failed > 0) {
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[repair-bkmv] fatal:", err);
    process.exit(1);
  });
