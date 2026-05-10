/**
 * Re-resolve historical inbound documents using the post-2026-05-10 (Layer 1)
 * franchisee-resolution pipeline.
 *
 * Why this script exists
 * ─────────────────────
 * Inbound emails from 2026-05-01..07 were processed BEFORE the Layer 1 hotfix
 * shipped — meaning they ran through the old:
 *   - bidirectional `findOperatingBrand` (.includes() in both directions)
 *   - 0.6 minConfidence floor with first-match-wins tiebreak
 *   - subject-only document-type classifier (no income-invoice rule, no body)
 *
 * Reut reported on 2026-05-10 that several of these documents ended up at the
 * wrong franchisee or were misclassified (HAAT-Netanzon → Vini-Azrieli, income
 * invoice committed as commission invoice, …). This script re-runs the new
 * resolver/classifier against the stored file in Vercel Blob and reports the
 * diff between the current `client_document` row and what the new pipeline
 * proposes — so we can review and fix without losing the original commit.
 *
 * Default mode is DRY-RUN: prints diffs only, never mutates. Pass `--apply`
 * to actually update `client_document.franchisee_id` / `document_type` for
 * any row whose proposal differs from current and meets the new acceptance
 * gate.
 *
 * Usage:
 *   npx tsx src/scripts/re-resolve-historical-inbound.ts            # dry-run, since 2026-05-01
 *   npx tsx src/scripts/re-resolve-historical-inbound.ts --since 2026-05-01
 *   npx tsx src/scripts/re-resolve-historical-inbound.ts --doc <docId>
 *   npx tsx src/scripts/re-resolve-historical-inbound.ts --apply --since 2026-05-01
 *
 * Output: a per-document diff line plus a final summary table.
 */
import "dotenv/config";
import { database } from "../db";
import {
  clientDocument,
  client,
  franchisee,
  gmailSyncLog,
  type Franchisee,
} from "../db/schema";
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { getClientParser, getInvoiceParser } from "../lib/client-parsers";
import { matchFranchiseeName } from "../lib/franchisee-matcher";
import {
  decideFranchiseeAcceptance,
  formatVerdictForLog,
} from "../lib/franchisee-match-acceptance";
import { findOperatingBrand } from "../lib/franchisee-parent-map";
import { detectDocumentType } from "../lib/email/classify-document-type";

const UNKNOWN = new Set(["לא זוהה", "Unknown", "unknown", ""]);

type DocumentTypeStr = "client_report" | "commission_invoice";

interface Diff {
  docId: string;
  clientCode: string | null;
  fileName: string;
  currentFranchiseeId: string;
  currentFranchiseeName: string;
  proposedFranchiseeId: string | null;
  proposedFranchiseeName: string | null;
  franchiseeChanged: boolean;
  currentDocType: DocumentTypeStr;
  proposedDocType: DocumentTypeStr;
  docTypeChanged: boolean;
  resolutionDetail: string;
  classificationDetail: string;
  acceptanceVerdict: string;
}

interface CliArgs {
  since: string;
  doc?: string;
  apply: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const out: CliArgs = { since: "2026-05-01", apply: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--since" && args[i + 1]) {
      out.since = args[i + 1];
      i++;
    } else if (a === "--doc" && args[i + 1]) {
      out.doc = args[i + 1];
      i++;
    }
  }
  return out;
}

async function fetchFileBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function inferMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

async function reResolveOne(
  doc: typeof clientDocument.$inferSelect,
  clientRow: typeof client.$inferSelect | null,
  franchisees: Franchisee[],
  emailSubject: string | null,
): Promise<Diff | null> {
  if (!doc.fileUrl) return null;

  const parserCode = clientRow?.parserCode || clientRow?.code || "";
  if (!parserCode) {
    console.warn(`  ${doc.id}: no parser code on client — skipping`);
    return null;
  }

  // Re-classify document type using the new (income-invoice-aware, body-fallback)
  // classifier. We don't have the body for historical emails (Resend retains
  // them ~7 days), so we pass only the subject — same as the live pipeline
  // would when no body is available.
  //
  // CRITICAL: when no subject is available (e.g. attachment row with no
  // gmail_sync_log linkage we could resolve), we MUST NOT propose a doc-type
  // change — the classifier defaults to `client_report` on empty subject and
  // would falsely "downgrade" every existing `commission_invoice`. Stick
  // with the current value as the proposal in that case.
  const currentDocType = doc.documentType as DocumentTypeStr;
  const subject = emailSubject ?? "";
  const proposedDocType: DocumentTypeStr = subject
    ? detectDocumentType(subject)
    : currentDocType;

  const fileBuffer = await fetchFileBuffer(doc.fileUrl);
  const mimeType = doc.mimeType || inferMimeType(doc.originalFileName);

  // Run the parser registered for the client+doc-type combo.
  const parser =
    proposedDocType === "commission_invoice"
      ? getInvoiceParser(parserCode)
      : getClientParser(parserCode);

  let extractedName: string | undefined;
  let resolutionDetail = "";
  let proposedFranchiseeId: string | null = null;
  let proposedFranchiseeName: string | null = null;
  let acceptanceVerdict = "n/a";

  if (parser) {
    try {
      const result = await parser(fileBuffer, mimeType);
      if (
        result.success &&
        result.data?.franchiseeName &&
        !UNKNOWN.has(result.data.franchiseeName)
      ) {
        extractedName = result.data.franchiseeName;

        // Parent-map (word-boundary forward + content-gated) override.
        const contentText = [
          result.data.rawText ?? "",
          ...(result.data.lineItems ?? []).map((li) => li.description ?? ""),
        ].join("\n");
        const parentOverride = findOperatingBrand(extractedName, contentText);
        if (parentOverride) {
          const operating = franchisees.find(
            (f) => f.id === parentOverride.operatingFranchiseeId,
          );
          if (operating) {
            proposedFranchiseeId = operating.id;
            proposedFranchiseeName = operating.name;
            resolutionDetail = `parent-map: "${extractedName}" → ${operating.name}`;
            acceptanceVerdict = "parent-map";
          } else {
            resolutionDetail = `parent-map matched "${extractedName}" but operating franchisee ${parentOverride.operatingFranchiseeId} inactive`;
          }
        }

        if (!proposedFranchiseeId) {
          const match = matchFranchiseeName(extractedName, franchisees, {
            minConfidence: 0.7,
          });
          const verdict = decideFranchiseeAcceptance(match);
          acceptanceVerdict = formatVerdictForLog(verdict);
          if (verdict.accept) {
            proposedFranchiseeId = verdict.franchiseeId;
            proposedFranchiseeName = verdict.franchiseeName;
            resolutionDetail = `parser: "${extractedName}" → ${verdict.franchiseeName} @${verdict.confidence.toFixed(2)}`;
          } else {
            resolutionDetail = `parser: "${extractedName}" rejected (${verdict.reason})`;
          }
        }
      } else {
        resolutionDetail = `parser produced no franchiseeName (success=${result.success})`;
      }
    } catch (err) {
      resolutionDetail = `parser threw: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    resolutionDetail = `no parser registered for ${parserCode}`;
  }

  const currentFranchisee = franchisees.find((f) => f.id === doc.franchiseeId);
  const currentFranchiseeName = currentFranchisee?.name ?? "(unknown)";

  const franchiseeChanged =
    proposedFranchiseeId !== null &&
    proposedFranchiseeId !== doc.franchiseeId;
  const docTypeChanged = proposedDocType !== currentDocType;

  return {
    docId: doc.id,
    clientCode: clientRow?.code ?? null,
    fileName: doc.originalFileName,
    currentFranchiseeId: doc.franchiseeId,
    currentFranchiseeName,
    proposedFranchiseeId,
    proposedFranchiseeName,
    franchiseeChanged,
    currentDocType,
    proposedDocType,
    docTypeChanged,
    resolutionDetail,
    classificationDetail: `subject="${subject || "(empty)"}" → ${proposedDocType}`,
    acceptanceVerdict,
  };
}

function formatDiffLine(d: Diff): string {
  const flags: string[] = [];
  if (d.franchiseeChanged) flags.push("FRANCHISEE");
  if (d.docTypeChanged) flags.push("DOC_TYPE");
  const tag = flags.length === 0 ? "ok" : `CHANGE: ${flags.join("+")}`;
  return [
    `[${tag}] ${d.docId.slice(0, 8)} ${d.clientCode ?? "?"} ${d.fileName.slice(0, 50)}`,
    `  fr current = ${d.currentFranchiseeName} (${d.currentFranchiseeId.slice(0, 8)})`,
    `  fr proposed = ${d.proposedFranchiseeName ?? "(no proposal)"} (${d.proposedFranchiseeId?.slice(0, 8) ?? "?"})`,
    `  type: ${d.currentDocType} → ${d.proposedDocType}`,
    `  resolution: ${d.resolutionDetail}`,
    `  classification: ${d.classificationDetail}`,
    `  verdict: ${d.acceptanceVerdict}`,
  ].join("\n");
}

/**
 * Strip the `#<attachment_id>` suffix that processClientDocument appends
 * when the gmailMessageId comes from an attachment-bearing email — leaves
 * the bare email_id we can join against gmail_sync_log on.
 */
function emailIdFromGmailMessageId(gmailMessageId: string): string {
  const hashIdx = gmailMessageId.indexOf("#");
  return hashIdx === -1 ? gmailMessageId : gmailMessageId.slice(0, hashIdx);
}

async function loadEmailSubjects(
  gmailMessageIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (gmailMessageIds.length === 0) return map;
  const emailIds = Array.from(
    new Set(gmailMessageIds.map(emailIdFromGmailMessageId)),
  );
  const rows = await database
    .select({ emailId: gmailSyncLog.emailId, subject: gmailSyncLog.subject })
    .from(gmailSyncLog)
    .where(inArray(gmailSyncLog.emailId, emailIds));
  for (const r of rows) {
    if (r.emailId && r.subject) map.set(r.emailId, r.subject);
  }
  return map;
}

async function applyDiff(d: Diff): Promise<void> {
  const updates: Partial<typeof clientDocument.$inferInsert> = {};
  if (d.franchiseeChanged && d.proposedFranchiseeId) {
    updates.franchiseeId = d.proposedFranchiseeId;
  }
  if (d.docTypeChanged) {
    updates.documentType = d.proposedDocType;
  }
  if (Object.keys(updates).length === 0) return;
  updates.updatedAt = new Date();
  await database
    .update(clientDocument)
    .set(updates)
    .where(eq(clientDocument.id, d.docId));
}

async function main() {
  const args = parseArgs();
  console.log(
    `[re-resolve] since=${args.since}${args.doc ? ` doc=${args.doc}` : ""} apply=${args.apply}`,
  );

  const conditions = [
    eq(clientDocument.source, "gmail_fetch"),
    isNotNull(clientDocument.fileUrl),
  ];
  if (args.doc) {
    conditions.push(eq(clientDocument.id, args.doc));
  } else {
    conditions.push(gte(clientDocument.createdAt, new Date(args.since)));
  }

  const docs = await database
    .select()
    .from(clientDocument)
    .where(and(...conditions))
    .orderBy(clientDocument.createdAt);

  console.log(`[re-resolve] ${docs.length} documents to re-process`);

  const allFranchisees = (await database.select().from(franchisee)) as Franchisee[];
  const activeFranchisees = allFranchisees.filter((f) => f.isActive);

  const clientIds = Array.from(
    new Set(docs.map((d) => d.clientId).filter((c): c is string => !!c)),
  );
  const clients =
    clientIds.length > 0
      ? await database
          .select()
          .from(client)
          .where(inArray(client.id, clientIds))
      : [];
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const gmailMessageIds = docs
    .map((d) => d.gmailMessageId)
    .filter((g): g is string => !!g);
  const subjectByEmailId = await loadEmailSubjects(gmailMessageIds);

  const diffs: Diff[] = [];
  let processed = 0;
  for (const doc of docs) {
    processed++;
    const clientRow = doc.clientId ? clientById.get(doc.clientId) ?? null : null;
    const subject = doc.gmailMessageId
      ? subjectByEmailId.get(emailIdFromGmailMessageId(doc.gmailMessageId)) ??
        null
      : null;
    try {
      const diff = await reResolveOne(doc, clientRow, activeFranchisees, subject);
      if (!diff) continue;
      diffs.push(diff);
      console.log(formatDiffLine(diff));
      console.log("");
      if (args.apply && (diff.franchiseeChanged || diff.docTypeChanged)) {
        await applyDiff(diff);
        console.log(`  → APPLIED`);
      }
    } catch (err) {
      console.warn(
        `[re-resolve] ${doc.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const changes = diffs.filter(
    (d) => d.franchiseeChanged || d.docTypeChanged,
  );
  console.log("");
  console.log(`──────────────── Summary ────────────────`);
  console.log(`  Processed:        ${processed}`);
  console.log(`  Diffs returned:   ${diffs.length}`);
  console.log(`  Changes proposed: ${changes.length}`);
  console.log(`    franchisee:     ${diffs.filter((d) => d.franchiseeChanged).length}`);
  console.log(`    doc_type:       ${diffs.filter((d) => d.docTypeChanged).length}`);
  console.log(`  Mode:             ${args.apply ? "APPLIED" : "DRY-RUN"}`);

  if (changes.length > 0 && !args.apply) {
    console.log("");
    console.log(
      "Re-run with --apply to actually update franchisee_id / document_type.",
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[re-resolve] fatal:", err);
  process.exit(1);
});
