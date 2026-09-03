/**
 * Adopt the franchisee's BKMV figure as the commission base for named rows of
 * ימה וקדמה Q2-2026.
 *
 * Two branches reconcile short: the supplier reported less than the
 * franchisee's own books show (קינג קונג רעננה 739 vs 2,553 — the supplier
 * bills it under the old אטפה entity — and מינה טומיי עין שמר 1,266 vs 1,686).
 * Asaf, 2026-09-03: bill on the franchisee amount.
 *
 * The supplier file is left exactly as the supplier sent it. Only the
 * commission rows move, and each carries the figure it replaced, so the board
 * keeps showing that the supplier under-reported instead of quietly agreeing
 * with itself. The reconciliation rows are marked manually approved with the
 * same note.
 *
 * ⚠ A re-sync of the source file (a re-upload, or another approve of it) writes
 * the commissions back from the file and undoes this. The difference reappears
 * on the reconciliation board when that happens — it is visible, not silent —
 * but it has to be re-applied.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/adopt-franchisee-amount-yama-q2.ts "<שם זכיין>" ... [--apply]
 */
import { database } from "@/db";
import { commission, franchisee, reconciliationComparison, reconciliationSession } from "@/db/schema";
import { and, eq, desc, isNull } from "drizzle-orm";
import { updateCommission } from "@/data-access/commissions";
import { updateComparisonStatus } from "@/data-access/reconciliation-v2";
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

  // The live session is the newest one that has not been superseded.
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
  if (!session) throw new Error("no live reconciliation session for this period");
  console.log(`סשן: ${session.id}\n`);

  const rows = await database
    .select({
      comparisonId: reconciliationComparison.id,
      franchiseeId: reconciliationComparison.franchiseeId,
      name: franchisee.name,
      supplierAmount: reconciliationComparison.supplierAmount,
      franchiseeAmount: reconciliationComparison.franchiseeAmount,
      status: reconciliationComparison.status,
    })
    .from(reconciliationComparison)
    .innerJoin(franchisee, eq(franchisee.id, reconciliationComparison.franchiseeId))
    .where(eq(reconciliationComparison.sessionId, session.id));

  for (const name of NAMES) {
    const row = rows.find((r) => r.name === name);
    if (!row) throw new Error(`"${name}" is not in this session`);

    const adopted = roundAmount(Number(row.franchiseeAmount));
    const reported = roundAmount(Number(row.supplierAmount));
    if (adopted <= 0) throw new Error(`"${name}" has no franchisee amount to adopt`);

    const [existing] = await database
      .select()
      .from(commission)
      .where(
        and(
          eq(commission.supplierId, SUPPLIER_ID),
          eq(commission.franchiseeId, row.franchiseeId),
          eq(commission.periodStartDate, PERIOD_START),
          eq(commission.periodEndDate, PERIOD_END)
        )
      )
      .limit(1);
    if (!existing) throw new Error(`no commission row for "${name}"`);
    if (existing.status !== "calculated" && existing.status !== "pending") {
      throw new Error(`"${name}" commission is ${existing.status} — approved or paid rows are not rewritten here`);
    }
    if (roundAmount(Number(existing.netAmount)) !== reported) {
      throw new Error(
        `"${name}": commission net ₪${existing.netAmount} does not match the session's supplier amount ₪${reported} — the session is out of date, rebuild it first`
      );
    }

    const rate = Number(existing.commissionRate);
    const netAmount = adopted;
    const grossAmount = roundAmount(adopted * (1 + VAT_RATE));
    const commissionAmount = roundAmount(adopted * (rate / 100));
    const note = `הסכום נלקח מדוח הזכיין (₪${adopted}) במקום מדיווח הספק (₪${reported}) — החלטת אסף 03/09/2026`;

    console.log(`${name}`);
    console.log(`  נטו   ₪${reported} → ₪${netAmount}`);
    console.log(`  ברוטו ₪${existing.grossAmount} → ₪${grossAmount}`);
    console.log(`  עמלה  ₪${existing.commissionAmount} → ₪${commissionAmount}  (${rate}%)`);
    console.log(`  השוואה: ${row.status} → manually_approved\n`);

    if (!APPLY) continue;

    await updateCommission(existing.id, {
      grossAmount: String(grossAmount),
      netAmount: String(netAmount),
      commissionAmount: String(commissionAmount),
      notes: note,
      metadata: {
        ...(existing.metadata ?? {}),
        franchiseeAmountAdopted: {
          supplierReported: reported,
          franchiseeReported: adopted,
          sessionId: session.id,
          appliedAt: new Date().toISOString(),
        },
      },
    } as never);
    await updateComparisonStatus(row.comparisonId, "manually_approved", ACTOR, note);
    console.log(`  נכתב.\n`);
  }

  if (!APPLY) console.log("(הרצה יבשה — הוסף --apply לכתיבה)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
