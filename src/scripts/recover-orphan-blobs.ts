/**
 * Comprehensive orphan-blob recovery for client documents.
 *
 * Reut 2026-05-10 reported "still many missing files". Investigation
 * showed that the gmail-fetch pipeline's step-4c dedup-replace
 * (clientId × franchiseeId × periodMonth × periodYear × documentType)
 * silently overwrites earlier rows when a newer email arrives for the
 * same tuple. The earlier file's blob is left intact in storage; only
 * the DB row is replaced. This script walks Vercel Blob, finds blobs
 * with no surviving client_document.file_url match, parses each, and
 * (when a row for that tuple is missing OR clearly attributable to a
 * different franchisee) inserts a new client_document.
 *
 * Heuristics:
 *   - We only consider blobs uploaded 2026-04-25 .. 2026-05-15.
 *   - We attempt parsing with the appropriate parser (client report or
 *     invoice based on filename hints).
 *   - We skip blobs we can't parse confidently (no franchisee match,
 *     no period extracted, etc.) — those need admin review.
 *   - When a row already exists for (client, franchisee, period, type)
 *     we DO NOT overwrite — we log a "potential duplicate" and skip,
 *     surfacing the case for manual disambiguation.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/recover-orphan-blobs.ts [--apply] [--client=CIBUS|HAAT|MISHLOCHA|TENBIS|WOLT]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { randomUUID } from "node:crypto";
import { database } from "@/db";
import { client, clientDocument, franchisee } from "@/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { matchFranchiseeName } from "@/lib/franchisee-matcher";
import { decideFranchiseeAcceptance } from "@/lib/franchisee-match-acceptance";
import { findOperatingBrand } from "@/lib/franchisee-parent-map";
import { getClientParser, getInvoiceParser } from "@/lib/client-parsers";
import type { ClientDocumentProcessingResult } from "@/lib/client-parsers/types";

const SCAN_FROM = "2026-04-25T00:00:00Z";
const SCAN_TO = "2026-05-15T00:00:00Z";

interface BlobItem {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: Date;
}

type DocumentTypeStr = "client_report" | "commission_invoice";

interface RecoveryDecision {
  blob: BlobItem;
  clientId: string;
  clientCode: string;
  documentType: DocumentTypeStr;
  parseResult: ClientDocumentProcessingResult;
  franchiseeId: string;
  franchiseeName: string;
  periodMonth: number;
  periodYear: number;
  status: "ready" | "skip-duplicate" | "skip-no-franchisee" | "skip-no-period" | "skip-parse-failed";
  reason?: string;
}

async function listBlobs(): Promise<BlobItem[]> {
  const { list } = await import("@vercel/blob");
  const all: BlobItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({
      prefix: "documents/client/",
      token: process.env.BLOB_READ_WRITE_TOKEN,
      limit: 1000,
      cursor,
    });
    for (const b of page.blobs) {
      const uploadedAt = new Date(b.uploadedAt as unknown as string);
      if (uploadedAt < new Date(SCAN_FROM) || uploadedAt >= new Date(SCAN_TO)) continue;
      all.push({
        url: b.url,
        pathname: b.pathname,
        size: b.size,
        uploadedAt,
      });
    }
    cursor = page.cursor;
  } while (cursor);
  return all;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function inferDocumentType(filename: string): DocumentTypeStr {
  // commission_invoice (client → franchisee charge):
  //   - SI<digits>            HAAT central commission invoices
  //   - Tax_Invoice_<digits>  Mishlocha/Wolt commission invoices
  //   - ezcount-invoice*      Mishlocha commission invoices via ezcount
  //   - 8093_he_<ts>.pdf      HAAT central commission (numeric prefix)
  if (
    /(?:^|[_-])SI\d|^Tax[_-]?Invoice/i.test(filename) ||
    /^ezcount-invoice/i.test(filename) ||
    /^\d{4,}_he_\d/i.test(filename)
  ) {
    return "commission_invoice";
  }
  // client_report (franchisee → client income invoice or report):
  //   - email-<uuid>.html     CIBUS / TENBIS HTML body reports
  //   - ezcount-<uuid>        ezcount-issued income invoices from franchisee
  //   - <id>_YYYYMMDD_*       TENBIS Mandrill / WOLT direct PDFs
  if (/^email-/.test(filename)) return "client_report";
  if (/^ezcount-[0-9a-f]/i.test(filename)) return "client_report";
  // Default: report (most common).
  return "client_report";
}

async function main() {
  const apply = process.argv.includes("--apply");
  const clientArg = process.argv.find((a) => a.startsWith("--client="));
  const clientFilter = clientArg?.split("=")[1] ?? null;

  console.log("Loading clients + franchisees…");
  const clients = await database.select().from(client).where(eq(client.isActive, true));
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const franchisees = await database
    .select()
    .from(franchisee)
    .where(eq(franchisee.isActive, true));

  console.log(`Loading blobs uploaded ${SCAN_FROM} → ${SCAN_TO}…`);
  const blobs = await listBlobs();
  console.log(`Found ${blobs.length} blobs in window.`);

  const allFileUrls = new Set(
    (
      await database
        .select({ url: clientDocument.fileUrl })
        .from(clientDocument)
        .where(isNotNull(clientDocument.fileUrl))
    ).map((r) => r.url)
  );

  const orphans = blobs.filter((b) => !allFileUrls.has(b.url));
  console.log(`Of which ${orphans.length} have NO matching client_document.file_url\n`);

  const decisions: RecoveryDecision[] = [];

  for (const blob of orphans) {
    // pathname format: documents/client/<clientId>/<filename>
    const parts = blob.pathname.split("/");
    if (parts.length < 4) continue;
    const clientId = parts[2];
    const filename = parts.slice(3).join("/");

    const c = clientById.get(clientId);
    if (!c) continue;
    if (clientFilter && c.code !== clientFilter) continue;

    const parserCode = c.code;
    const documentType = inferDocumentType(filename);

    const parser =
      documentType === "commission_invoice"
        ? getInvoiceParser(parserCode)
        : getClientParser(parserCode);

    if (!parser) {
      decisions.push({
        blob,
        clientId,
        clientCode: c.code ?? "",
        documentType,
        parseResult: { success: false, data: null, errors: [], warnings: [] },
        franchiseeId: "",
        franchiseeName: "",
        periodMonth: 0,
        periodYear: 0,
        status: "skip-parse-failed",
        reason: `no parser for ${parserCode}`,
      });
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = await downloadBuffer(blob.url);
    } catch (err) {
      decisions.push({
        blob,
        clientId,
        clientCode: c.code ?? "",
        documentType,
        parseResult: { success: false, data: null, errors: [], warnings: [] },
        franchiseeId: "",
        franchiseeName: "",
        periodMonth: 0,
        periodYear: 0,
        status: "skip-parse-failed",
        reason: `download failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    const mimeType = filename.endsWith(".html") || filename.endsWith(".htm")
      ? "text/html"
      : "application/pdf";

    let parseResult: ClientDocumentProcessingResult;
    try {
      parseResult = await parser(buffer, mimeType);
    } catch (err) {
      decisions.push({
        blob,
        clientId,
        clientCode: c.code ?? "",
        documentType,
        parseResult: { success: false, data: null, errors: [], warnings: [] },
        franchiseeId: "",
        franchiseeName: "",
        periodMonth: 0,
        periodYear: 0,
        status: "skip-parse-failed",
        reason: `parse threw: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    if (parseResult.skipPersist) {
      decisions.push({
        blob,
        clientId,
        clientCode: c.code ?? "",
        documentType,
        parseResult,
        franchiseeId: "",
        franchiseeName: "",
        periodMonth: 0,
        periodYear: 0,
        status: "skip-parse-failed",
        reason: `parser flagged skipPersist (${parseResult.warnings.join(" | ")})`,
      });
      continue;
    }
    if (!parseResult.success || !parseResult.data) {
      decisions.push({
        blob,
        clientId,
        clientCode: c.code ?? "",
        documentType,
        parseResult,
        franchiseeId: "",
        franchiseeName: "",
        periodMonth: 0,
        periodYear: 0,
        status: "skip-parse-failed",
        reason: parseResult.errors.join(" | ") || "parser returned no data",
      });
      continue;
    }

    const data = parseResult.data;
    if (!data.periodMonth || !data.periodYear) {
      decisions.push({
        blob,
        clientId,
        clientCode: c.code ?? "",
        documentType,
        parseResult,
        franchiseeId: "",
        franchiseeName: "",
        periodMonth: 0,
        periodYear: 0,
        status: "skip-no-period",
      });
      continue;
    }

    // Resolve franchisee
    let franchiseeId = "";
    let franchiseeName = "";
    const candidate = data.franchiseeName ?? "";

    // Build content text for parent-brand-map gate
    const contentText = [
      data.rawText ?? "",
      ...(data.lineItems ?? []).map((li) => li.description ?? ""),
    ].join("\n");

    const parentOverride = findOperatingBrand(candidate, contentText);
    if (parentOverride) {
      const operating = franchisees.find(
        (f) => f.id === parentOverride.operatingFranchiseeId
      );
      if (operating) {
        franchiseeId = operating.id;
        franchiseeName = operating.name;
      }
    }

    if (!franchiseeId) {
      const match = matchFranchiseeName(candidate, franchisees, {
        minConfidence: 0.7,
      });
      const verdict = decideFranchiseeAcceptance(match);
      if (verdict.accept) {
        franchiseeId = verdict.franchiseeId;
        franchiseeName = verdict.franchiseeName;
      }
    }

    if (!franchiseeId) {
      decisions.push({
        blob,
        clientId,
        clientCode: c.code ?? "",
        documentType,
        parseResult,
        franchiseeId: "",
        franchiseeName: "",
        periodMonth: data.periodMonth,
        periodYear: data.periodYear,
        status: "skip-no-franchisee",
        reason: `cannot resolve franchisee from "${candidate}"`,
      });
      continue;
    }

    // Check duplicate
    const [existing] = await database
      .select({
        id: clientDocument.id,
        totalAmount: clientDocument.totalAmount,
      })
      .from(clientDocument)
      .where(
        and(
          eq(clientDocument.clientId, clientId),
          eq(clientDocument.franchiseeId, franchiseeId),
          eq(clientDocument.periodMonth, data.periodMonth),
          eq(clientDocument.periodYear, data.periodYear),
          eq(clientDocument.documentType, documentType)
        )
      )
      .limit(1);

    if (existing) {
      const existingAmt = existing.totalAmount
        ? parseFloat(existing.totalAmount)
        : 0;
      const sameAmt = Math.abs(existingAmt - data.totalAmount) < 0.01;
      decisions.push({
        blob,
        clientId,
        clientCode: c.code ?? "",
        documentType,
        parseResult,
        franchiseeId,
        franchiseeName,
        periodMonth: data.periodMonth,
        periodYear: data.periodYear,
        status: "skip-duplicate",
        reason: sameAmt
          ? `existing row matches (${existingAmt})`
          : `existing row diff amount (existing=${existingAmt}, blob=${data.totalAmount})`,
      });
      continue;
    }

    decisions.push({
      blob,
      clientId,
      clientCode: c.code ?? "",
      documentType,
      parseResult,
      franchiseeId,
      franchiseeName,
      periodMonth: data.periodMonth,
      periodYear: data.periodYear,
      status: "ready",
    });
  }

  // Summary
  const byStatus: Record<string, number> = {};
  for (const d of decisions) byStatus[d.status] = (byStatus[d.status] || 0) + 1;
  console.log("Summary:", byStatus, "\n");

  // Print "ready" rows for visibility
  const ready = decisions.filter((d) => d.status === "ready");
  console.log(`READY TO INSERT (${ready.length}):`);
  for (const d of ready) {
    console.log(
      `  [${d.clientCode.padEnd(10)}] ${d.franchiseeName.padEnd(30)} ${d.documentType.padEnd(20)} ${d.periodMonth}/${d.periodYear} total=${d.parseResult.data?.totalAmount} blob=${d.blob.pathname.split("/").pop()?.slice(0, 40)}`
    );
  }

  // Print "skip-duplicate" rows with amount mismatch (interesting)
  const dupMismatch = decisions.filter(
    (d) => d.status === "skip-duplicate" && d.reason?.includes("diff amount")
  );
  if (dupMismatch.length) {
    console.log(`\nDUPLICATE WITH AMOUNT MISMATCH (${dupMismatch.length}) — admin review:`);
    for (const d of dupMismatch) {
      console.log(
        `  [${d.clientCode.padEnd(10)}] ${d.franchiseeName.padEnd(30)} ${d.documentType.padEnd(20)} ${d.periodMonth}/${d.periodYear} ${d.reason}`
      );
    }
  }

  // Print "skip-no-franchisee" (couldn't auto-attribute)
  const noFr = decisions.filter((d) => d.status === "skip-no-franchisee");
  if (noFr.length) {
    console.log(`\nNO FRANCHISEE MATCH (${noFr.length}):`);
    for (const d of noFr) {
      console.log(
        `  [${d.clientCode.padEnd(10)}] parsed="${d.parseResult.data?.franchiseeName}" ${d.documentType.padEnd(20)} ${d.periodMonth}/${d.periodYear} blob=${d.blob.pathname.split("/").pop()?.slice(0, 40)}`
      );
    }
  }

  // Optionally print parse-failed reasons
  if (process.argv.includes("--verbose")) {
    const failed = decisions.filter((d) => d.status === "skip-parse-failed");
    if (failed.length) {
      console.log(`\nPARSE FAILED (${failed.length}):`);
      for (const d of failed) {
        console.log(
          `  [${d.clientCode.padEnd(10)}] ${d.documentType.padEnd(20)} blob=${d.blob.pathname.split("/").pop()?.slice(0, 50)} reason=${d.reason}`
        );
      }
    }
  }

  if (!apply) {
    console.log("\nDry-run. Pass --apply to insert ready rows.");
    return;
  }

  // Insert ready rows
  let inserted = 0;
  let skipped = 0;
  for (const d of ready) {
    if (!d.parseResult.data) continue;
    const data = d.parseResult.data;
    const docId = randomUUID();
    try {
      await database.insert(clientDocument).values({
      id: docId,
      clientId: d.clientId,
      franchiseeId: d.franchiseeId,
      documentType: d.documentType,
      source: "gmail_fetch",
      originalFileName: d.blob.pathname.split("/").pop() ?? "recovered.pdf",
      fileUrl: d.blob.url,
      fileSize: d.blob.size,
      mimeType: d.blob.pathname.endsWith(".html") ? "text/html" : "application/pdf",
      periodMonth: d.periodMonth,
      periodYear: d.periodYear,
      processingStatus: "auto_approved",
      processingResult: d.parseResult as unknown as Record<string, unknown>,
      totalAmount: data.totalAmount.toString(),
      commissionAmount: data.commissionAmount.toString(),
      commissionRate: data.commissionRate.toString(),
      netAmount: data.netAmount.toString(),
      invoiceNumber: data.invoiceNumber ?? null,
      allocationNumber: data.allocationNumber ?? null,
      gmailMessageId: `recovered-${docId}`,
      reviewNotes:
        "שוחזר אוטומטית 2026-05-10 ע\"י recover-orphan-blobs.ts — קובץ הגיע לאחסון אבל אין שורת DB מתאימה. ייתכן שנדרס בעבר על ידי מסמך אחר באמצעות dedup-replace.",
      updatedAt: new Date(),
      });
      inserted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Unique-constraint hit means another orphan covering the same
      // (client × franchisee × period × commission_invoice) tuple was
      // inserted earlier in this run. The remaining duplicate gets
      // skipped — this is correct: only one commission_invoice can
      // exist per tuple and the first wins.
      if (msg.includes("idx_client_doc_unique_invoice")) {
        skipped++;
        console.log(
          `  ↳ skipped ${d.clientCode} ${d.franchiseeName} (commission_invoice unique constraint — another orphan already covered this tuple)`
        );
        continue;
      }
      throw err;
    }
  }
  console.log(`\nInserted ${inserted} rows; skipped ${skipped} unique-constraint duplicates.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
