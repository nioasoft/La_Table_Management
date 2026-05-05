/**
 * Inspect a failed inbound-email row in `gmail_sync_log`.
 *
 * Looks up the row by id (or email_id), fetches the original email from
 * Resend Inbound, and dumps:
 *   - email metadata (from / to / subject / created_at)
 *   - body excerpt (HTML preferred, falls back to plain text)
 *   - attachment list with content-type + size
 *   - first 2000 chars of pdf-parse output for each PDF attachment
 *
 * Used to diagnose Cibus/Tnbis ingestion failures without forwarding the
 * email out of the system or chasing Vercel console logs.
 *
 * Usage:
 *   npx tsx scripts/inspect-failed-inbound.ts <syncLogId-or-emailId> [...]
 */
import "dotenv/config";
import { fetchInboundEmail, downloadAttachment } from "../src/lib/email/inbound";
import { database } from "../src/db";
import { gmailSyncLog } from "../src/db/schema";
import { eq } from "drizzle-orm";

const PDF_PREVIEW_CHARS = 5000;
const BODY_PREVIEW_CHARS = 20000;

async function resolveEmailId(idOrEmailId: string): Promise<string | null> {
  // Try treat input as gmail_sync_log primary key first
  const byPk = await database
    .select({ emailId: gmailSyncLog.emailId, subject: gmailSyncLog.subject, clientCode: gmailSyncLog.clientCode })
    .from(gmailSyncLog)
    .where(eq(gmailSyncLog.id, idOrEmailId))
    .limit(1);
  if (byPk[0]?.emailId) {
    console.log(
      `[inspect] sync_log ${idOrEmailId.slice(0, 8)} → email ${byPk[0].emailId.slice(0, 8)} (client=${byPk[0].clientCode}, subject=${byPk[0].subject})`,
    );
    return byPk[0].emailId;
  }
  // Otherwise treat input as the Resend email_id directly
  return idOrEmailId;
}

async function inspect(idOrEmailId: string): Promise<void> {
  const emailId = await resolveEmailId(idOrEmailId);
  if (!emailId) {
    console.error(`[inspect] could not resolve ${idOrEmailId} to an email_id`);
    return;
  }

  const email = await fetchInboundEmail(emailId);
  if (!email) {
    console.error(`[inspect] fetchInboundEmail returned null for ${emailId}`);
    return;
  }

  console.log("\n========== EMAIL ==========");
  console.log(`id:        ${email.id}`);
  console.log(`from:      ${email.from}`);
  console.log(`to:        ${JSON.stringify(email.to)}`);
  console.log(`subject:   ${email.subject}`);
  console.log(`createdAt: ${email.createdAt}`);
  console.log(`attachmentCount: ${email.attachments.length}`);

  console.log("\n========== BODY (HTML) ==========");
  if (email.html) {
    console.log(email.html.slice(0, BODY_PREVIEW_CHARS));
    if (email.html.length > BODY_PREVIEW_CHARS) {
      console.log(`\n... [truncated; total ${email.html.length} chars]`);
    }
  } else {
    console.log("(no html)");
  }

  console.log("\n========== BODY (TEXT) ==========");
  if (email.text) {
    console.log(email.text.slice(0, BODY_PREVIEW_CHARS));
    if (email.text.length > BODY_PREVIEW_CHARS) {
      console.log(`\n... [truncated; total ${email.text.length} chars]`);
    }
  } else {
    console.log("(no plain text)");
  }

  console.log("\n========== ATTACHMENTS ==========");
  if (email.attachments.length === 0) {
    console.log("(no attachments)");
    return;
  }

  for (const att of email.attachments) {
    console.log(`\n--- ${att.filename} (${att.contentType}, ${att.size} bytes) ---`);
    const buffer = await downloadAttachment(att.downloadUrl);
    if (!buffer) {
      console.log("(failed to download)");
      continue;
    }
    if (att.contentType?.includes("pdf") || att.filename.toLowerCase().endsWith(".pdf")) {
      try {
        // Use createRequire to dodge the pdf-parse + tsx ESM gotcha
        // (see memory: gotcha-inbound-email-pipeline)
        const { createRequire } = await import("module");
        const require = createRequire(import.meta.url);
        const pdfParse = require("pdf-parse/lib/pdf-parse.js");
        const parsed = await pdfParse(buffer);
        const text = parsed.text ?? "";
        console.log(text.slice(0, PDF_PREVIEW_CHARS));
        if (text.length > PDF_PREVIEW_CHARS) {
          console.log(`\n... [truncated; total ${text.length} chars]`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`(pdf-parse failed: ${msg})`);
      }
    } else {
      console.log("(non-PDF attachment, skipping content dump)");
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: npx tsx scripts/inspect-failed-inbound.ts <syncLogId-or-emailId> [...]",
    );
    process.exit(1);
  }
  for (const arg of args) {
    try {
      await inspect(arg);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[inspect] ${arg} failed: ${msg}`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
