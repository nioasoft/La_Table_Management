/**
 * One-off: retire the two upload-link supplier files whose period was stamped
 * from row dates instead of the supplier's quarter (the route didn't snap —
 * fixed in the same commit). A sweep of every live file found only these two:
 *
 *   עלה עלה  c2a79a6f  2026-07-01..08-01  → "יולי-אוג׳" in the period picker
 *   פרסקו    de99ed46  2026-07-01..07-16  → "יולי-יולי"
 *
 * On 2026-10-18 Reut re-uploaded both through the admin screen (which snaps),
 * getting Jul–Sep copies (a5060a59 identical; 1c3100c9 the same file
 * reprocessed, +1 matched row). They didn't replace the originals because the
 * periods differed, so each quarter showed twice. Per supplier this does what
 * "החלף קובץ קיים" would have: delete the old file's calculated commissions,
 * reject it, re-sync commissions from the new file if they moved, archive the
 * old-period sessions, and make sure a Jul–Sep session exists.
 *
 * No session involved has manual approvals or notes (checked 2026-10-18).
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/heal-unsnapped-link-periods.ts          # dry run
 *   dotenv -e .env -- npx tsx src/scripts/heal-unsnapped-link-periods.ts --apply
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { commission, reconciliationSession, user } from "@/db/schema";
import { and, count, eq, isNull } from "drizzle-orm";
import { deleteCommissionsBySourceFile } from "@/data-access/commissions";
import {
  getSupplierFileById,
  reviewSupplierFile,
  syncCommissionsFromUpload,
} from "@/data-access/supplier-file-uploads";
import { createReconciliationSession } from "@/data-access/reconciliation-v2";

const APPLY = process.argv.includes("--apply");
const Q3 = { start: "2026-07-01", end: "2026-09-30" };

const CASES = [
  { label: "עלה עלה", oldFile: "c2a79a6f-ccc6-4a8b-b1a1-8613328eccf4", newFile: "a5060a59-f117-4569-b963-e7c9b5d0b962" },
  { label: "פרסקו", oldFile: "de99ed46-bce4-44cc-bfcd-865683ecf0e6", newFile: "1c3100c9-2396-449c-b699-3fb5fb7bdedb" },
];

const activeSessions = (where: ReturnType<typeof and>) =>
  database.select().from(reconciliationSession).where(and(isNull(reconciliationSession.archivedAt), where));

// reviewed_by / created_by are FKs to user — "system" is not a user.
let actorId = "";

async function heal(c: (typeof CASES)[number]) {
  const [oldF, newF] = await Promise.all([getSupplierFileById(c.oldFile), getSupplierFileById(c.newFile)]);
  if (!oldF || !newF) throw new Error(`${c.label}: file missing`);
  if (oldF.processingStatus === "rejected") return console.log(`${c.label}: old file already rejected — skip`);
  if (newF.processingStatus === "rejected" || newF.periodStartDate !== Q3.start || newF.periodEndDate !== Q3.end)
    throw new Error(`${c.label}: new file changed (${newF.processingStatus} ${newF.periodStartDate}..${newF.periodEndDate})`);

  const oldSessions = await activeSessions(eq(reconciliationSession.supplierFileId, c.oldFile));
  const q3Sessions = await activeSessions(
    and(
      eq(reconciliationSession.supplierId, newF.supplierId),
      eq(reconciliationSession.periodStartDate, Q3.start),
      eq(reconciliationSession.periodEndDate, Q3.end)
    )
  );
  const [{ value: newCommissions }] = await database
    .select({ value: count() })
    .from(commission)
    .where(eq(commission.sourceFileId, c.newFile));

  console.log(
    `${c.label}: reject ${oldF.originalFileName} (${oldF.periodStartDate}..${oldF.periodEndDate}); ` +
      `archive ${oldSessions.length} session(s); new file has ${newCommissions} commissions; ` +
      `${q3Sessions.length ? "Q3 session exists" : "will build Q3 session"}`
  );
  if (!APPLY) return;

  const deleted = await deleteCommissionsBySourceFile(c.oldFile);
  await reviewSupplierFile(c.oldFile, "reject", actorId, "הוחלף בקובץ חדש (אותו דוח, תקופה רבעונית מתוקנת)");
  // Same report, so the new file owes the commissions — sync whenever it has none
  // (also recovers a run that died after the delete).
  if (newCommissions === 0) {
    const sync = await syncCommissionsFromUpload(c.newFile, actorId);
    console.log(`  ${deleted} old commissions deleted, new file synced → ${JSON.stringify(sync)}`);
  }
  for (const s of oldSessions) {
    await database
      .update(reconciliationSession)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(reconciliationSession.id, s.id));
  }
  if (q3Sessions.length === 0) {
    const createdBy = oldSessions[0]?.createdBy ?? newF.createdBy;
    if (!createdBy) throw new Error(`${c.label}: no user to own the Q3 session`);
    const s = await createReconciliationSession(newF.supplierId, c.newFile, Q3.start, Q3.end, createdBy);
    console.log(`  Q3 session ${s?.id} (${s?.totalFranchisees} rows, needs review ${s?.needsReviewCount})`);
  }
  console.log(`✓ ${c.label}`);
}

async function main() {
  const [asaf] = await database.select({ id: user.id }).from(user).where(eq(user.email, "benatia.asaf@gmail.com"));
  if (!asaf) throw new Error("operator user not found");
  actorId = asaf.id;
  for (const c of CASES) await heal(c);
  if (!APPLY) console.log("\nDry run — re-run with --apply to write.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
