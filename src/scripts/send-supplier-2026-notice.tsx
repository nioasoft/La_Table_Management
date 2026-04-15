/**
 * One-off: send a reminder to every supplier whose settlement_report file_request
 * is still in 'sent' status (i.e. they haven't uploaded yet), with the regular
 * supplier-request wording PLUS a bold notice at the top announcing that
 * starting 2026 reports must be submitted via the attached link.
 *
 * Usage:
 *   npx tsx src/scripts/send-supplier-2026-notice.ts           # dry-run (default)
 *   npx tsx src/scripts/send-supplier-2026-notice.ts --send    # actually send
 *
 * Dry-run mode:
 *  - Prints every recipient (name, email, period, brands)
 *  - Writes a single rendered HTML preview to /tmp/supplier-2026-notice-preview.html
 *  - Does NOT send any email and does NOT touch the database
 */

import "dotenv/config";

process.env.NEXT_PUBLIC_APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://www.latable.co.il";

import * as React from "react";
import { writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { Resend } from "resend";
import {
  Button,
  Section,
  Text,
  render,
} from "@react-email/components";
import { and, eq } from "drizzle-orm";

import { database } from "../db";
import {
  fileRequest,
  uploadLink,
  supplier,
  emailLog,
} from "../db/schema";
import { EmailLayout } from "../emails/components/email-layout";

// -----------------------------------------------------------------------------
// Email component — based on SupplierRequestEmail + bold notice at the top.
// -----------------------------------------------------------------------------

interface SupplierNoticeEmailProps {
  displayBrands: string;
  period: string;
  periodEndDate: string;
  uploadLink: string;
}

const NOTICE_TEXT =
  "החל משנת 2026 יש לשלוח את הדוחות לעמלות רשת בקישור המצורף מטה, תודה על שיתוף הפעולה. זמינה לכל שאלה";

function SupplierNoticeEmail({
  displayBrands,
  period,
  periodEndDate,
  uploadLink: uploadUrl,
}: SupplierNoticeEmailProps) {
  const subject = `בקשת דוח עמלות רשת - ${period}`;

  return (
    <EmailLayout preview={subject}>
      <Section style={section}>
        <Section style={noticeBox}>
          <Text style={noticeText}>{NOTICE_TEXT}</Text>
        </Section>

        <Text style={text}>שלום רב,</Text>
        <Text style={text}>נבקש מכם להעלות דוח עמלות רשת עבור:</Text>
        <Text style={brandLine} dir="ltr">
          LA TABLE ({displayBrands})
        </Text>
        <Text style={text}>
          לתקופה שמסתיימת ב-{periodEndDate}, בקישור המצורף מטה.
        </Text>
        <Section style={buttonSection}>
          <Button style={button} href={uploadUrl}>
            קישור להעלאת הדוח
          </Button>
        </Section>
        <Text style={text}>נודה להעלאת הדוח בהקדם האפשרי.</Text>
        <Text style={text}>
          במידה וקיימת שאלה או תקלה בתהליך ההעלאה – נשמח לסייע.
        </Text>
        <Text style={text}>תודה רבה על שיתוף הפעולה,</Text>
      </Section>
    </EmailLayout>
  );
}

const section: React.CSSProperties = { padding: "0 20px" };

const text: React.CSSProperties = {
  color: "#333333",
  fontSize: "14px",
  lineHeight: "24px",
  margin: "16px 0",
  direction: "rtl" as const,
  textAlign: "right" as const,
};

const brandLine: React.CSSProperties = {
  color: "#1a1a1a",
  fontSize: "16px",
  fontWeight: "700",
  lineHeight: "24px",
  margin: "0 0 16px",
  textAlign: "center" as const,
  letterSpacing: "0.5px",
};

const buttonSection: React.CSSProperties = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button: React.CSSProperties = {
  background: "#2563eb",
  backgroundColor: "#2563eb",
  borderRadius: "6px",
  border: "none",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "14px 32px",
};

const noticeBox: React.CSSProperties = {
  backgroundColor: "#fff7ed",
  border: "2px solid #f59e0b",
  borderRadius: "8px",
  padding: "16px 20px",
  margin: "0 0 24px",
};

const noticeText: React.CSSProperties = {
  color: "#92400e",
  fontSize: "15px",
  fontWeight: "700",
  lineHeight: "24px",
  margin: "0",
  direction: "rtl" as const,
  textAlign: "right" as const,
};

// -----------------------------------------------------------------------------
// Script
// -----------------------------------------------------------------------------

const SUPPLIER_REQUEST_TEMPLATE_ID = "71b31e21-fdf9-4782-968d-4c1c86d4deed";
const FROM_EMAIL = process.env.EMAIL_FROM || "office@latable.co.il";
const FROM_NAME = process.env.EMAIL_FROM_NAME || "רעות - La Table";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.latable.co.il";
const PREVIEW_PATH = "/tmp/supplier-2026-notice-preview.html";

interface PendingRow {
  fileRequestId: string;
  supplierName: string;
  recipientEmail: string;
  recipientName: string | null;
  sentAt: Date | null;
  uploadToken: string;
  period: string;
  periodEndDate: string;
  brands: string;
  remindersSent: string[];
}

async function fetchPendingRequests(): Promise<PendingRow[]> {
  const rows = await database
    .select({
      fileRequestId: fileRequest.id,
      supplierName: supplier.name,
      recipientEmail: fileRequest.recipientEmail,
      recipientName: fileRequest.recipientName,
      sentAt: fileRequest.sentAt,
      uploadToken: uploadLink.token,
      dueDate: fileRequest.dueDate,
      metadata: fileRequest.metadata,
      remindersSent: fileRequest.remindersSent,
    })
    .from(fileRequest)
    .innerJoin(supplier, eq(supplier.id, fileRequest.entityId))
    .innerJoin(uploadLink, eq(uploadLink.id, fileRequest.uploadLinkId))
    .where(
      and(
        eq(fileRequest.entityType, "supplier"),
        eq(fileRequest.status, "sent"),
        eq(fileRequest.documentType, "settlement_report")
      )
    );

  return rows.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const period = String(meta.periodDescription ?? "");
    const brands = String(meta.brandNames ?? "");
    return {
      fileRequestId: r.fileRequestId,
      supplierName: r.supplierName,
      recipientEmail: r.recipientEmail,
      recipientName: r.recipientName,
      sentAt: r.sentAt,
      uploadToken: r.uploadToken,
      period,
      periodEndDate: r.dueDate ?? "",
      brands,
      remindersSent: (r.remindersSent ?? []) as string[],
    };
  });
}

async function renderForRow(row: PendingRow): Promise<{ html: string; text: string; subject: string }> {
  const uploadUrl = `${APP_URL}/upload/${row.uploadToken}`;
  const element = SupplierNoticeEmail({
    displayBrands: row.brands || "La Table",
    period: row.period,
    periodEndDate: row.periodEndDate,
    uploadLink: uploadUrl,
  });
  const html = await render(element);
  const text = await render(element, { plainText: true });
  const subject = `בקשת דוח עמלות רשת - ${row.period}`;
  return { html, text, subject };
}

async function sendOne(
  resend: Resend,
  row: PendingRow
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const { html, text, subject } = await renderForRow(row);

  const logId = randomUUID();
  await database.insert(emailLog).values({
    id: logId,
    templateId: SUPPLIER_REQUEST_TEMPLATE_ID,
    toEmail: row.recipientEmail,
    toName: row.recipientName,
    fromEmail: FROM_EMAIL,
    fromName: FROM_NAME,
    subject,
    bodyHtml: html,
    bodyText: text,
    status: "pending",
    entityType: "file_request",
    entityId: row.fileRequestId,
    metadata: {
      fileRequestId: row.fileRequestId,
      scriptRun: "send-supplier-2026-notice",
      isReminder: true,
      hasNotice2026: true,
    },
  });

  const sendResult = await resend.emails.send({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: row.recipientEmail,
    subject,
    html,
    text,
  });

  if (sendResult.error || !sendResult.data?.id) {
    await database
      .update(emailLog)
      .set({
        status: "failed",
        failedAt: new Date(),
        errorMessage: sendResult.error?.message || "Unknown Resend error",
      })
      .where(eq(emailLog.id, logId));
    return { ok: false, error: sendResult.error?.message || "Unknown Resend error" };
  }

  const messageId = sendResult.data.id;

  await database
    .update(emailLog)
    .set({
      status: "sent",
      sentAt: new Date(),
      messageId,
    })
    .where(eq(emailLog.id, logId));

  const nextReminders = [...row.remindersSent, new Date().toISOString()];
  await database
    .update(fileRequest)
    .set({ remindersSent: nextReminders, updatedAt: new Date() })
    .where(eq(fileRequest.id, row.fileRequestId));

  return { ok: true, messageId };
}

async function main() {
  const shouldSend = process.argv.includes("--send");
  const mode = shouldSend ? "SEND" : "DRY-RUN";

  console.log(`\n========================================`);
  console.log(`  Mode: ${mode}`);
  console.log(`  From: ${FROM_NAME} <${FROM_EMAIL}>`);
  console.log(`  App URL: ${APP_URL}`);
  console.log(`========================================\n`);

  const rows = await fetchPendingRequests();
  console.log(`Found ${rows.length} pending supplier file requests.\n`);

  if (rows.length === 0) {
    console.log("Nothing to do. Exiting.");
    process.exit(0);
  }

  console.log("Recipients:");
  rows.forEach((r, i) => {
    console.log(
      `  ${String(i + 1).padStart(2, "0")}. ${r.supplierName.padEnd(35)} | ${r.recipientEmail.padEnd(35)} | ${r.period} | brands: ${r.brands}`
    );
  });
  console.log("");

  if (!shouldSend) {
    // Dry-run: write a single preview HTML using the first row
    const previewRow = rows[0];
    const { html, subject } = await renderForRow(previewRow);
    writeFileSync(PREVIEW_PATH, html, "utf-8");
    console.log(`✓ Preview written to ${PREVIEW_PATH}`);
    console.log(`  Preview recipient: ${previewRow.supplierName} (${previewRow.recipientEmail})`);
    console.log(`  Preview subject:   ${subject}`);
    console.log(`\nOpen with: open ${PREVIEW_PATH}`);
    console.log(`\n⚠️  DRY-RUN — no emails were sent, no DB rows were changed.`);
    console.log(`    To actually send, re-run with --send`);
    process.exit(0);
  }

  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set. Aborting.");
    process.exit(1);
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  let sent = 0;
  let failed = 0;
  const failures: { supplier: string; email: string; error: string }[] = [];

  for (const row of rows) {
    try {
      const result = await sendOne(resend, row);
      if (result.ok) {
        sent++;
        console.log(`✓ ${row.supplierName} -> ${row.recipientEmail} (msg ${result.messageId})`);
      } else {
        failed++;
        failures.push({
          supplier: row.supplierName,
          email: row.recipientEmail,
          error: result.error || "unknown",
        });
        console.log(`✗ ${row.supplierName} -> ${row.recipientEmail} FAILED: ${result.error}`);
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ supplier: row.supplierName, email: row.recipientEmail, error: msg });
      console.log(`✗ ${row.supplierName} -> ${row.recipientEmail} THREW: ${msg}`);
    }

    // Be a polite API citizen to avoid hitting rate limits.
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`\n========================================`);
  console.log(`  Sent:    ${sent}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`========================================\n`);

  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach((f) => console.log(`  - ${f.supplier} (${f.email}): ${f.error}`));
  }

  process.exit(failed > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
