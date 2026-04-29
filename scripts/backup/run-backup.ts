/**
 * Daily database backup orchestration script.
 *
 * Runs from GitHub Actions after `pg_dump` produces a dump file. Uploads the
 * file to Vercel Blob, emails the download link to admins, and deletes blobs
 * older than the retention period.
 *
 * Required env vars:
 *   DUMP_FILE                  - path to the pg_dump output file
 *   BACKUP_DATE                - YYYY-MM-DD date string (the backup's logical date)
 *   BLOB_READ_WRITE_TOKEN      - Vercel Blob write token
 *   RESEND_API_KEY             - Resend API key
 *   EMAIL_FROM                 - sender address (e.g. office@latable.co.il)
 *   EMAIL_FROM_NAME            - sender display name
 *   BACKUP_NOTIFICATION_TO     - primary recipient (e.g. reutl@latableg.com)
 *   BACKUP_NOTIFICATION_CC     - optional CC recipient
 *   BACKUP_RETENTION_DAYS      - optional, defaults to 30
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { put, list, del } from "@vercel/blob";
import { Resend } from "resend";
import { renderBackupEmailHtml, renderBackupEmailText } from "./email-template.js";

const BLOB_PREFIX = "database-backups/";

interface BackupConfig {
  dumpFile: string;
  backupDate: string;
  blobToken: string;
  resendApiKey: string;
  emailFrom: string;
  emailFromName: string;
  notificationTo: string;
  notificationCc: string | undefined;
  retentionDays: number;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadConfig(): BackupConfig {
  const retentionRaw = process.env.BACKUP_RETENTION_DAYS;
  const retentionDays = retentionRaw ? Number.parseInt(retentionRaw, 10) : 30;
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    throw new Error(`Invalid BACKUP_RETENTION_DAYS: ${retentionRaw}`);
  }
  return {
    dumpFile: getRequiredEnv("DUMP_FILE"),
    backupDate: getRequiredEnv("BACKUP_DATE"),
    blobToken: getRequiredEnv("BLOB_READ_WRITE_TOKEN"),
    resendApiKey: getRequiredEnv("RESEND_API_KEY"),
    emailFrom: getRequiredEnv("EMAIL_FROM"),
    emailFromName: process.env.EMAIL_FROM_NAME ?? "La Table Management",
    notificationTo: getRequiredEnv("BACKUP_NOTIFICATION_TO"),
    notificationCc: process.env.BACKUP_NOTIFICATION_CC,
    retentionDays,
  };
}

interface UploadedBackup {
  url: string;
  pathname: string;
  sizeBytes: number;
}

async function uploadDump(config: BackupConfig): Promise<UploadedBackup> {
  const fileStats = await stat(config.dumpFile);
  if (fileStats.size === 0) {
    throw new Error(`Dump file is empty: ${config.dumpFile}`);
  }

  const fileName = basename(config.dumpFile);
  const pathname = `${BLOB_PREFIX}${config.backupDate}-${fileName}`;

  console.log(`Uploading ${fileName} (${fileStats.size} bytes) to Vercel Blob...`);

  const stream = createReadStream(config.dumpFile);
  const blob = await put(pathname, stream, {
    access: "public",
    addRandomSuffix: true,
    contentType: "application/octet-stream",
    multipart: true,
    token: config.blobToken,
  });

  console.log(`Upload complete: ${blob.url}`);

  return {
    url: blob.url,
    pathname: blob.pathname,
    sizeBytes: fileStats.size,
  };
}

async function sendNotification(
  config: BackupConfig,
  uploaded: UploadedBackup
): Promise<void> {
  const resend = new Resend(config.resendApiKey);

  const html = renderBackupEmailHtml({
    date: config.backupDate,
    sizeBytes: uploaded.sizeBytes,
    downloadUrl: uploaded.url,
    retentionDays: config.retentionDays,
  });
  const text = renderBackupEmailText({
    date: config.backupDate,
    sizeBytes: uploaded.sizeBytes,
    downloadUrl: uploaded.url,
    retentionDays: config.retentionDays,
  });

  console.log(`Sending notification email to ${config.notificationTo}...`);

  const { data, error } = await resend.emails.send({
    from: `${config.emailFromName} <${config.emailFrom}>`,
    to: [config.notificationTo],
    cc: config.notificationCc ? [config.notificationCc] : undefined,
    subject: `גיבוי מסד נתונים יומי - ${config.backupDate}`,
    html,
    text,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }

  console.log(`Email sent. ID: ${data?.id}`);
}

interface CleanupResult {
  scanned: number;
  deleted: number;
}

async function cleanupOldBackups(
  config: BackupConfig,
  currentBackupPathname: string
): Promise<CleanupResult> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - config.retentionDays);

  console.log(
    `Cleaning up backups older than ${config.retentionDays} days (before ${cutoff.toISOString()})...`
  );

  const result: CleanupResult = { scanned: 0, deleted: 0 };
  let cursor: string | undefined;

  do {
    const page = await list({
      prefix: BLOB_PREFIX,
      cursor,
      limit: 1000,
      token: config.blobToken,
    });
    result.scanned += page.blobs.length;

    const stale = page.blobs.filter((blob) => {
      if (blob.pathname === currentBackupPathname) return false;
      const uploadedAt = new Date(blob.uploadedAt);
      return uploadedAt < cutoff;
    });

    if (stale.length > 0) {
      const urls = stale.map((b) => b.url);
      await del(urls, { token: config.blobToken });
      result.deleted += stale.length;
      for (const blob of stale) {
        console.log(`  Deleted: ${blob.pathname} (uploaded ${blob.uploadedAt})`);
      }
    }

    cursor = page.cursor;
  } while (cursor);

  console.log(`Cleanup complete. Scanned: ${result.scanned}, Deleted: ${result.deleted}`);
  return result;
}

async function main(): Promise<void> {
  const config = loadConfig();

  const uploaded = await uploadDump(config);

  let emailError: unknown;
  try {
    await sendNotification(config, uploaded);
  } catch (error) {
    emailError = error;
    console.error("Email notification failed:", error);
  }

  try {
    await cleanupOldBackups(config, uploaded.pathname);
  } catch (error) {
    console.error("Cleanup failed (non-fatal):", error);
  }

  if (emailError) {
    throw new Error(
      `Backup uploaded successfully to ${uploaded.url}, but email notification failed: ${
        emailError instanceof Error ? emailError.message : String(emailError)
      }`
    );
  }

  console.log("Backup workflow completed successfully.");
}

main().catch((error: unknown) => {
  console.error("Backup failed:", error);
  process.exit(1);
});
