/**
 * One-off CLI: backfill `client_document.allocation_number` for ezcount /
 * Hyp-EasyCount client_report invoices whose מספר הקצאה was present in the
 * PDF but never extracted.
 *
 * Root cause (fixed in extract-allocation-number.ts 2026-06-15): ezcount glues
 * a 17-digit issue timestamp directly onto the 9-digit allocation number with
 * no separator, e.g. "20260601224523045152063195הקצאה מספר:". The isolated
 * (?<!\d)(\d{9}) patterns could not match through the timestamp, so the
 * allocation silently came back undefined → blank "מספר הקצאה" column in the
 * journal-entries Hashavshevet export (Reut 2026-06-15: "קינג קונג ביג משלוחה
 * חסר מספר הקצאה — לא לקח מהחשבונית לפקודת יומן").
 *
 * Strategy: re-download each affected blob, re-extract with the fixed
 * extractAllocationNumber, and UPDATE the column. Only touches client_report
 * rows that currently have no allocation number.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/backfill-ezcount-allocation-numbers.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { createRequire } from "node:module";
import { database } from "@/db";
import { clientDocument } from "@/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { extractAllocationNumber } from "@/lib/client-parsers/extract-allocation-number";

const pdfParse = createRequire(import.meta.url)("pdf-parse/lib/pdf-parse.js");

const APPLY = process.argv.includes("--apply");

async function main() {
  // Affected set: client_report rows from the ezcount path with no allocation
  // number. We re-extract for all of them; only those where the PDF actually
  // carries an allocation get updated.
  const candidates = await database
    .select({
      id: clientDocument.id,
      fileUrl: clientDocument.fileUrl,
      fileName: clientDocument.originalFileName,
      clientId: clientDocument.clientId,
      periodMonth: clientDocument.periodMonth,
      periodYear: clientDocument.periodYear,
    })
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.documentType, "client_report"),
        or(
          isNull(clientDocument.allocationNumber),
          eq(clientDocument.allocationNumber, "")
        )
      )
    );

  console.log(
    `${APPLY ? "[APPLY]" : "[DRY-RUN]"} scanning ${candidates.length} client_report rows with no allocation number\n`
  );

  let extracted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of candidates) {
    if (!doc.fileUrl) {
      skipped++;
      continue;
    }
    try {
      const res = await fetch(doc.fileUrl);
      if (!res.ok) {
        console.warn(`  ⚠️  ${doc.fileName}: HTTP ${res.status}`);
        failed++;
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const pdf = await pdfParse(buf);
      const allocation = extractAllocationNumber(pdf.text as string);

      if (!allocation) {
        skipped++;
        continue;
      }
      extracted++;
      console.log(
        `  ✓ ${doc.periodYear}-${String(doc.periodMonth).padStart(2, "0")} ${doc.fileName} → הקצאה ${allocation}`
      );

      if (APPLY) {
        await database
          .update(clientDocument)
          .set({ allocationNumber: allocation })
          .where(eq(clientDocument.id, doc.id));
        updated++;
      }
    } catch (err) {
      console.warn(
        `  ⚠️  ${doc.fileName}: ${err instanceof Error ? err.message : String(err)}`
      );
      failed++;
    }
  }

  console.log(
    `\n${APPLY ? "[APPLY]" : "[DRY-RUN]"} done — extracted: ${extracted}, updated: ${updated}, skipped (no allocation): ${skipped}, failed: ${failed}`
  );
  if (!APPLY && extracted > 0) {
    console.log("Re-run with --apply to write the changes.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
