/**
 * Backfill the Israeli tax allocation number (מספר הקצאה) on existing
 * client_document rows where it is currently NULL.
 *
 * This complements the parser changes that started extracting allocation_number
 * for new uploads — old rows need the same value applied retroactively so the
 * Hashavshevet journal-entries export shows the right number for past periods.
 *
 * Strategy:
 *   1. Find every client_document with allocation_number IS NULL whose client
 *      has a parser registered (WOLT, MISHLOCHA, HAAT, TENBIS, CIBUS).
 *   2. For each, download the original file from file_url, run the parser
 *      matching the documentType (commission_invoice → INVOICE_PARSERS,
 *      anything else → CLIENT_PARSERS).
 *   3. If the parser returns an allocationNumber, write it back to the row.
 *   4. Print a per-row summary plus aggregate counts.
 *
 * Idempotent: only updates rows where the column is currently NULL, so reruns
 * are safe. Documents under the threshold (no allocation number on the file)
 * stay NULL and will be retried on future runs — that's expected.
 *
 * Usage:
 *   npx tsx scripts/backfill-allocation-numbers.ts             # dry-run (no writes)
 *   npx tsx scripts/backfill-allocation-numbers.ts --apply     # write updates
 *   npx tsx scripts/backfill-allocation-numbers.ts --apply --client=WOLT
 */
import "dotenv/config";
import { eq, and, isNull, inArray, or } from "drizzle-orm";
import { database } from "../src/db";
import { clientDocument, client } from "../src/db/schema";
import { getClientParser, getInvoiceParser } from "../src/lib/client-parsers";

const APPLY = process.argv.includes("--apply");
const CLIENT_FILTER = process.argv
  .find((a) => a.startsWith("--client="))
  ?.replace("--client=", "");
// Vercel Blob rate-limits parallel fetches; serial with a small delay is reliable.
const FETCH_DELAY_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Codes whose parsers extract allocation numbers.
const SUPPORTED_CODES = ["WOLT", "MISHLOCHA", "HAAT", "TENBIS", "CIBUS"];

interface RowSummary {
  id: string;
  clientCode: string;
  documentType: string;
  fileName: string | null;
  period: string;
  status:
    | "updated"
    | "no_url"
    | "fetch_failed"
    | "parse_failed"
    | "no_parser"
    | "no_allocation"
    | "skipped_dry_run";
  allocationNumber?: string;
  message?: string;
}

async function main() {
  console.log(
    `Allocation-number backfill — mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}` +
      (CLIENT_FILTER ? `  filter: ${CLIENT_FILTER}` : "") +
      "\n"
  );

  // 1. Resolve client codes -> ids
  const codes = CLIENT_FILTER ? [CLIENT_FILTER] : SUPPORTED_CODES;
  const clients = await database
    .select({ id: client.id, code: client.code, name: client.name })
    .from(client)
    .where(inArray(client.code, codes));

  if (clients.length === 0) {
    console.log("No matching clients found.");
    return;
  }

  for (const c of clients) {
    console.log(`Client: ${c.name} (${c.code})  id=${c.id}`);
  }

  const clientIdToCode = new Map(clients.map((c) => [c.id, c.code ?? ""]));

  // 2. Fetch candidate documents (allocation_number IS NULL).
  const docs = await database
    .select({
      id: clientDocument.id,
      clientId: clientDocument.clientId,
      documentType: clientDocument.documentType,
      fileUrl: clientDocument.fileUrl,
      mimeType: clientDocument.mimeType,
      originalFileName: clientDocument.originalFileName,
      periodMonth: clientDocument.periodMonth,
      periodYear: clientDocument.periodYear,
    })
    .from(clientDocument)
    .where(
      and(
        isNull(clientDocument.allocationNumber),
        inArray(
          clientDocument.clientId,
          clients.map((c) => c.id)
        ),
        // tabit_report files are internal Excel reconciliations — they never
        // carry an Israeli tax allocation number, and trying to parse them
        // through the PDF parsers just produces noise.
        or(
          eq(clientDocument.documentType, "client_report"),
          eq(clientDocument.documentType, "commission_invoice")
        )
      )
    );

  console.log(
    `\nFound ${docs.length} document(s) without allocation_number\n`
  );

  const results: RowSummary[] = [];

  for (const doc of docs) {
    const code = doc.clientId ? (clientIdToCode.get(doc.clientId) ?? "") : "";
    const period = `${String(doc.periodMonth).padStart(2, "0")}/${doc.periodYear}`;
    const base: RowSummary = {
      id: doc.id,
      clientCode: code,
      documentType: doc.documentType,
      fileName: doc.originalFileName,
      period,
      status: "no_allocation",
    };

    if (!doc.fileUrl) {
      results.push({ ...base, status: "no_url", message: "No file_url" });
      continue;
    }

    const parser =
      doc.documentType === "commission_invoice"
        ? getInvoiceParser(code)
        : getClientParser(code);

    if (!parser) {
      results.push({ ...base, status: "no_parser" });
      continue;
    }

    try {
      await sleep(FETCH_DELAY_MS);
      const res = await fetch(doc.fileUrl);
      if (!res.ok) {
        results.push({
          ...base,
          status: "fetch_failed",
          message: `HTTP ${res.status}`,
        });
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const parsed = await parser(buf, doc.mimeType ?? "application/pdf");

      if (!parsed.success || !parsed.data) {
        results.push({
          ...base,
          status: "parse_failed",
          message: parsed.errors.join("; "),
        });
        continue;
      }

      const allocationNumber = parsed.data.allocationNumber;
      if (!allocationNumber) {
        results.push({ ...base, status: "no_allocation" });
        continue;
      }

      if (!APPLY) {
        results.push({
          ...base,
          allocationNumber,
          status: "skipped_dry_run",
        });
        continue;
      }

      await database
        .update(clientDocument)
        .set({
          allocationNumber,
          updatedAt: new Date(),
        })
        .where(eq(clientDocument.id, doc.id));

      results.push({
        ...base,
        allocationNumber,
        status: "updated",
      });
    } catch (err) {
      results.push({
        ...base,
        status: "parse_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. Print report
  console.log("Results:\n");
  for (const r of results) {
    const fileShort = (r.fileName ?? "?").substring(0, 50);
    const allocStr = r.allocationNumber ? ` -> ${r.allocationNumber}` : "";
    console.log(
      `  [${r.status.toUpperCase().padEnd(16)}] ${r.clientCode.padEnd(10)} ${r.documentType.padEnd(20)} ${r.period}  ${fileShort}${allocStr}`
    );
    if (r.message) {
      console.log(`      ${r.message}`);
    }
  }

  // 4. Aggregate counts
  console.log("\nSummary:");
  const counts: Record<string, number> = {};
  for (const r of results) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }
  for (const [status, count] of Object.entries(counts)) {
    console.log(`  ${status}: ${count}`);
  }
  console.log(`  total: ${results.length}`);

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to write updates.");
  }
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
