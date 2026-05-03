/**
 * POST /api/admin/reprocess-wolt-fileb — One-shot recovery for Wolt File B.
 *
 * Background: prior to 2026-05-03, every Wolt inbound email saved only File A
 * (commission_invoice from Wolt to the restaurant). File B (sales tax invoice
 * from the restaurant TO Wolt Enterprises — needed for the Tabit
 * reconciliation) was silently dropped, because both attachments were
 * processed with the same `gmail_message_id` and the 2nd one hit the UNIQUE
 * constraint and got marked as duplicate.
 *
 * The webhook is now fixed (uses `${email_id}#${attachment.id}`), but the
 * historical emails need a one-pass recovery. This endpoint:
 *
 *   1. Finds every Wolt commission_invoice with a `gmail_message_id` that
 *      does NOT yet have a sibling client_report from the same email.
 *   2. Fetches the email from Resend, downloads each ezcount PDF.
 *   3. Detects File B via `isWoltEzcountFileB`.
 *   4. Routes File B through the same `processClientDocument` pipeline as
 *      live inbound, with a unique composite key `${email_id}#${attachmentId}`.
 *
 * Idempotent — running it again is a no-op once File B records exist.
 *
 * Restricted to super_user.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { clientDocument, client, franchisee } from "@/db/schema";
import { eq, and, isNotNull, like } from "drizzle-orm";
import { processClientDocument } from "@/lib/client-document-processor";
import { isWoltEzcountFileB } from "@/lib/client-parsers/wolt-parser";
import { matchFranchiseeName } from "@/lib/franchisee-matcher";
import type { Franchisee } from "@/db/schema";

interface ResendAttachment {
  id: string;
  filename: string;
  size: number;
  content_type: string;
}

interface ResendEmailResponse {
  id: string;
  from: string;
  to: string[];
  subject: string;
  attachments?: ResendAttachment[];
}

async function resendGet<T>(path: string): Promise<T | null> {
  const res = await fetch(`https://api.resend.com${path}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  if (!res.ok) {
    console.error(`Resend GET ${path} failed: ${res.status}`);
    return null;
  }
  return (await res.json()) as T;
}

export async function POST(request: NextRequest) {
  const authResult = await requireSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";

  // ── Find Wolt client ──
  const [woltClient] = await database
    .select()
    .from(client)
    .where(eq(client.code, "WOLT"))
    .limit(1);
  if (!woltClient) {
    return NextResponse.json({ error: "Wolt client not configured" }, { status: 404 });
  }

  // ── Find candidate Wolt commission_invoice docs (have email_id, no '#') ──
  // Old key format = bare email_id; new key format = `${emailId}#${attId}`.
  // Only the OLD-format records need recovery.
  const candidates = await database
    .select({
      id: clientDocument.id,
      gmailMessageId: clientDocument.gmailMessageId,
      franchiseeId: clientDocument.franchiseeId,
      periodMonth: clientDocument.periodMonth,
      periodYear: clientDocument.periodYear,
      originalFileName: clientDocument.originalFileName,
    })
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.clientId, woltClient.id),
        eq(clientDocument.documentType, "commission_invoice"),
        isNotNull(clientDocument.gmailMessageId)
      )
    );

  // Drop records whose gmail_message_id already has the new composite-key form.
  const oldFormatCandidates = candidates.filter(
    (c) => c.gmailMessageId && !c.gmailMessageId.includes("#")
  );

  // Load all active franchisees once (for re-resolving when needed).
  const allFranchisees = (await database
    .select()
    .from(franchisee)
    .where(eq(franchisee.isActive, true))) as Franchisee[];

  type ReprocessOutcome = {
    emailId: string;
    rawAttachments: number;
    fileBFound: boolean;
    fileBAttachmentId?: string;
    fileBFilename?: string;
    result?: "created" | "duplicate" | "error" | "no-file-b";
    error?: string;
  };

  const outcomes: ReprocessOutcome[] = [];
  let createdCount = 0;

  for (const candidate of oldFormatCandidates) {
    const emailId = candidate.gmailMessageId!;
    const outcome: ReprocessOutcome = {
      emailId,
      rawAttachments: 0,
      fileBFound: false,
    };

    // Fetch email metadata
    const email = await resendGet<ResendEmailResponse>(
      `/emails/receiving/${emailId}`
    );
    if (!email) {
      outcome.result = "error";
      outcome.error = "Failed to fetch email from Resend";
      outcomes.push(outcome);
      continue;
    }

    const allAttachments = email.attachments ?? [];
    outcome.rawAttachments = allAttachments.length;

    // Identify ezcount candidates — Hebrew-prefix single-underscore PDFs
    // (mirrors filterAttachments logic in the inbound webhook).
    const ezcountCandidates = allAttachments.filter((a) => {
      if (a.content_type !== "application/pdf") return false;
      const lower = a.filename.toLowerCase();
      if (/sales_report|netting|commission/.test(lower)) return false;
      // Hebrew-prefix single-underscore filename (mirrors filterAttachments
      // in src/app/api/clients/email-inbound/route.ts).
      return /^[֐-׿][֐-׿ ]*_(?!_)/.test(a.filename);
    });

    let fileB: ResendAttachment | null = null;
    for (const cand of ezcountCandidates) {
      // Skip the attachment that produced the existing commission_invoice
      // (we know its filename — File A).
      if (cand.filename === candidate.originalFileName) continue;

      const dlMeta = await resendGet<{ download_url: string }>(
        `/emails/receiving/${emailId}/attachments/${cand.id}`
      );
      if (!dlMeta) continue;
      const pdfRes = await fetch(dlMeta.download_url);
      if (!pdfRes.ok) continue;
      const buf = Buffer.from(await pdfRes.arrayBuffer());

      if (await isWoltEzcountFileB(buf)) {
        fileB = cand;
        outcome.fileBFound = true;
        outcome.fileBAttachmentId = cand.id;
        outcome.fileBFilename = cand.filename;

        if (dryRun) {
          outcome.result = "created";
          break;
        }

        // Re-resolve franchisee from the parsed PDF (defensive — File B
        // contains the restaurant as issuer, which may differ from File A's
        // recipient when there are multi-brand operating companies).
        let franchiseeId = candidate.franchiseeId;
        try {
          // Use the wolt parser to extract the franchisee name.
          const { parseWoltFile } = await import(
            "@/lib/client-parsers/wolt-parser"
          );
          const parsed = await parseWoltFile(buf, "application/pdf");
          if (parsed.success && parsed.data?.franchiseeName) {
            const m = matchFranchiseeName(
              parsed.data.franchiseeName,
              allFranchisees,
              { minConfidence: 0.6 }
            );
            if (m.matchedFranchisee) {
              franchiseeId = m.matchedFranchisee.id;
            }
          }
        } catch (err) {
          console.warn(
            `[reprocess-wolt-fileb] franchisee re-resolve failed for ${emailId}:`,
            err
          );
        }

        const result = await processClientDocument({
          buffer: buf,
          fileName: cand.filename,
          mimeType: "application/pdf",
          clientId: woltClient.id,
          parserCode: "WOLT",
          franchiseeId,
          periodMonth: candidate.periodMonth,
          periodYear: candidate.periodYear,
          documentType: "client_report",
          source: "gmail_fetch",
          gmailMessageId: `${emailId}#${cand.id}`,
        });

        if (result.skippedDuplicate) {
          outcome.result = "duplicate";
        } else if (result.success) {
          outcome.result = "created";
          createdCount++;
        } else {
          outcome.result = "error";
          outcome.error = result.error ?? "processClientDocument failed";
        }
        break;
      }
    }

    if (!outcome.fileBFound) {
      outcome.result = "no-file-b";
    }

    outcomes.push(outcome);
  }

  return NextResponse.json({
    success: true,
    dryRun,
    candidatesScanned: oldFormatCandidates.length,
    fileBCreated: createdCount,
    outcomes,
  });
}
