/**
 * One-off CLI: re-bill Q3-2026 מזרח ומערב after the parser fix for untitled
 * sections.
 *
 * Background (Reut, 2026-10-19): the approved Q3 file is a manual edit of the
 * supplier's original — column A ("שם סוכן") was deleted, taking the
 * "קאסטרה 10%" title with it. The title-driven parser then billed the 10%
 * rows at 17% (₪60,548 instead of ₪58,368) and read the supplier's invoice
 * line ("הסכם 922") as an unmatched franchisee. Net amounts — and therefore
 * reconciliation — were already right; only commissions were wrong.
 *
 * Reprocesses the approved file with the fixed parser and re-syncs its
 * commissions. Usage:
 *   npx tsx src/scripts/fix-mizrach-q3-2026-untitled-section.ts [--apply]
 */

import "dotenv/config";
import { database } from "@/db";
import { commission, supplierFileUpload } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { reprocessSupplierFileById } from "@/data-access/supplier-file-reprocess";
import { syncCommissionsFromUpload } from "@/data-access/supplier-file-uploads";
import { parseMizrachUmaaravFile } from "@/lib/custom-parsers/mizrach-umaarav-parser";

const FILE_ID = "6ae3d873-7e34-4c65-b88d-ca95c15c5d12";
const SUPPLIER_ID = "fef9fe2d-fd35-4c66-a772-d01b36551647";
const EXPECTED_COMMISSION = 58368; // 325,014.39×17% + 31,152.64×10% — the supplier's own invoice lines

async function commissionSum(): Promise<number> {
  const rows = await database
    .select({ amount: commission.commissionAmount })
    .from(commission)
    .where(and(eq(commission.supplierId, SUPPLIER_ID), eq(commission.periodStartDate, "2026-07-01")));
  return rows.reduce((acc, r) => acc + parseFloat(r.amount), 0);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const [file] = await database
    .select({ url: supplierFileUpload.fileUrl, status: supplierFileUpload.processingStatus, reviewer: supplierFileUpload.reviewedBy })
    .from(supplierFileUpload)
    .where(eq(supplierFileUpload.id, FILE_ID))
    .limit(1);
  if (!file?.url || !file.reviewer) throw new Error("file, blob or reviewer missing");

  const parsed = parseMizrachUmaaravFile(Buffer.from(await (await fetch(file.url)).arrayBuffer()));
  const newSum = parsed.data.reduce((acc, d) => acc + (d.preCalculatedCommission ?? 0), 0);
  console.log(`file status=${file.status}  commissions now ₪${await commissionSum()}  fixed parser ₪${newSum} (${parsed.data.length} rows)`);
  if (newSum !== EXPECTED_COMMISSION) throw new Error(`fixed parser gives ₪${newSum}, expected ₪${EXPECTED_COMMISSION}`);

  if (!apply) {
    console.log("(dry run — re-run with --apply to reprocess and re-sync)");
    process.exit(0);
  }

  const rep = await reprocessSupplierFileById(FILE_ID);
  if (!rep.success) throw new Error(`reprocess failed: ${rep.error}`);
  console.log("sync:", await syncCommissionsFromUpload(FILE_ID, file.reviewer));
  console.log(`commissions after ₪${await commissionSum()}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
