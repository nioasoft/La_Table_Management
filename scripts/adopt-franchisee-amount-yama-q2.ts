/**
 * Write the franchisee's BKMV figure into ימה וקדמה's Q2-2026 file as the
 * billed amount for named branches, then re-derive the commissions from it.
 *
 * Two branches reconciled short: the supplier reported less than the
 * franchisee's own books show — קינג קונג רעננה ₪739 against ₪2,553 (the
 * supplier bills it under the old אטפה entity, so most of the quarter never
 * reached our side of its report) and מינה טומיי עין שמר ₪1,266 against ₪1,686.
 * Asaf, 2026-09-03: bill on the franchisee amount.
 *
 * The amount is written into the stored processing result rather than onto the
 * commission rows, so it is the file — the one thing every downstream reader
 * derives from — that carries the decision. A later re-sync, re-approve or
 * rebuild now reproduces it instead of quietly reverting to what the supplier
 * sent. The workbook itself is untouched in Blob storage, and each figure that
 * was replaced is recorded in the file's review notes.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/adopt-franchisee-amount-yama-q2.ts "<שם זכיין>" ... [--apply]
 */
import { database } from "@/db";
import {
  commission,
  franchisee,
  reconciliationComparison,
  reconciliationSession,
  supplierFileUpload,
} from "@/db/schema";
import { and, eq, desc, isNull } from "drizzle-orm";
import {
  getSupplierFileByPeriod,
  syncCommissionsFromUpload,
} from "@/data-access/supplier-file-uploads";
import { markSupplierSessionsStale } from "@/data-access/reconciliation-v2";
import { roundAmount } from "@/lib/file-processor";

const SUPPLIER_ID = "931d9637-923b-4e73-af06-116bd7647623"; // ימה וקדמה
const PERIOD_START = "2026-04-01";
const PERIOD_END = "2026-06-30";
const VAT_RATE = 0.18; // this supplier's report is ex-VAT; gross = net × 1.18
const ACTOR = "YeUolzuyyTtH7d7bXEHeGIR3GewDlSE8"; // רעות לוי

const APPLY = process.argv.includes("--apply");
const NAMES = process.argv.slice(2).filter((a) => !a.startsWith("--"));

async function main() {
  if (NAMES.length === 0) throw new Error('usage: "<שם זכיין>" ... [--apply]');

  const file = await getSupplierFileByPeriod(
    SUPPLIER_ID,
    new Date(PERIOD_START),
    new Date(PERIOD_END)
  );
  if (!file?.processingResult) throw new Error("no live file for this period");
  console.log(`קובץ: ${file.originalFileName} (${file.id}, ${file.processingStatus})`);

  const [session] = await database
    .select()
    .from(reconciliationSession)
    .where(
      and(
        eq(reconciliationSession.supplierId, SUPPLIER_ID),
        eq(reconciliationSession.periodStartDate, PERIOD_START),
        isNull(reconciliationSession.staleAt)
      )
    )
    .orderBy(desc(reconciliationSession.createdAt))
    .limit(1);
  if (!session) throw new Error("no live reconciliation session — rebuild it first");
  console.log(`סשן: ${session.id}\n`);

  const comparisons = await database
    .select({
      franchiseeId: reconciliationComparison.franchiseeId,
      name: franchisee.name,
      supplierAmount: reconciliationComparison.supplierAmount,
      franchiseeAmount: reconciliationComparison.franchiseeAmount,
    })
    .from(reconciliationComparison)
    .innerJoin(franchisee, eq(franchisee.id, reconciliationComparison.franchiseeId))
    .where(eq(reconciliationComparison.sessionId, session.id));

  const matches = file.processingResult.franchiseeMatches.map((m) => ({ ...m }));
  const applied: string[] = [];

  for (const name of NAMES) {
    const cmp = comparisons.find((c) => c.name === name);
    if (!cmp) throw new Error(`"${name}" is not in this session`);

    const adopted = roundAmount(Number(cmp.franchiseeAmount));
    if (adopted <= 0) throw new Error(`"${name}" has no franchisee amount to adopt`);

    const row = matches.find((m) => m.matchedFranchiseeId === cmp.franchiseeId);
    if (!row) throw new Error(`"${name}" has no row in the file`);

    if (roundAmount(row.netAmount) === adopted) {
      console.log(`${name}: כבר ₪${adopted} — דילוג\n`);
      continue;
    }

    // A commission already approved or paid is not silently rebased.
    const [existing] = await database
      .select({ status: commission.status })
      .from(commission)
      .where(
        and(
          eq(commission.supplierId, SUPPLIER_ID),
          eq(commission.franchiseeId, cmp.franchiseeId),
          eq(commission.periodStartDate, PERIOD_START),
          eq(commission.periodEndDate, PERIOD_END)
        )
      )
      .limit(1);
    if (existing && existing.status !== "calculated" && existing.status !== "pending") {
      throw new Error(`"${name}" commission is ${existing.status} — not rewritten here`);
    }

    const reported = roundAmount(row.netAmount);
    console.log(`${name}`);
    console.log(`  נטו   ₪${reported} → ₪${adopted}   (דיווח הספק → דוח הזכיין)`);
    console.log(`  ברוטו ₪${row.grossAmount} → ₪${roundAmount(adopted * (1 + VAT_RATE))}\n`);

    row.netAmount = adopted;
    row.grossAmount = roundAmount(adopted * (1 + VAT_RATE));
    applied.push(`${name}: ₪${reported} → ₪${adopted}`);
  }

  if (applied.length === 0) {
    console.log("אין מה לעדכן.");
    process.exit(0);
  }

  const totalNetAmount = roundAmount(matches.reduce((t, m) => t + m.netAmount, 0));
  const totalGrossAmount = roundAmount(matches.reduce((t, m) => t + m.grossAmount, 0));
  console.log(`סה"כ קובץ: נטו ₪${file.processingResult.totalNetAmount} → ₪${totalNetAmount}`);
  console.log(`            ברוטו ₪${file.processingResult.totalGrossAmount} → ₪${totalGrossAmount}\n`);

  if (!APPLY) {
    console.log("(הרצה יבשה — הוסף --apply לכתיבה)");
    process.exit(0);
  }

  const note = `סכומים שנלקחו מדוחות הזכיינים במקום מדיווח הספק (החלטת אסף 03/09/2026): ${applied.join("; ")}`;
  await database
    .update(supplierFileUpload)
    .set({
      processingResult: {
        ...file.processingResult,
        franchiseeMatches: matches,
        totalNetAmount,
        totalGrossAmount,
      },
      reviewNotes: [file.reviewNotes, note].filter(Boolean).join(" | "),
      updatedAt: new Date(),
    })
    .where(eq(supplierFileUpload.id, file.id));
  console.log("הקובץ עודכן.");

  const sync = await syncCommissionsFromUpload(file.id, ACTOR);
  console.log(`עמלות: נוצרו ${sync.created}, נכשלו ${sync.failed}${sync.skipped ? ` (דולג: ${sync.reason})` : ""}`);

  const stale = await markSupplierSessionsStale(SUPPLIER_ID, PERIOD_START, PERIOD_END);
  console.log(`סשני התאמה שסומנו לרענון: ${stale}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
