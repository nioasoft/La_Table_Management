/**
 * One-off CLI: restore 10bis's July 2026 commission invoices.
 *
 * Reut, 2026-08-11: "there is a report for every branch but no invoice."
 * Confirmed — July had 7 client_reports and only 3 commission invoices.
 *
 * Cause (fixed in invoice-tenbis-parser.ts, same change set):
 * 10bis dropped the "דוח <חודש>" line-item description during the July cycle,
 * so the period fell back to the invoice date. Two bugs then filed invoices
 * under the wrong month, where each collided with an older invoice for the
 * same franchisee and was refused by the overwrite guard:
 *
 *   • The fallback used the invoice's own month. But 10bis bills on two
 *     schedules — a last-day-of-month invoice covers THAT month, a mid-month
 *     one covers the month BEFORE. June's ₪2,578.01 (500113385, dated 16/07)
 *     therefore landed in ויני עזריאלי's JULY slot.
 *   • The Hebrew-month scan matched substrings, and 'קסטרא טומאיי בע"מ'
 *     contains "מאי" — so קסטרא's July invoice resolved to MAY.
 *
 * What this script does:
 *   1. Move 500113385 (₪2,578.01, ויני עזריאלי) from July to June, where it
 *      belongs — this also frees the July slot.
 *   2. Commit 400183008 (₪2,241, קסטרא) into July from the review queue.
 *   3. Commit 400183172 (₪3,658, Azrieli ENTITY) into July, SPLIT between
 *      ויני עזריאלי and נתנזון — see below.
 *
 * Why 400183172 is split:
 * Like the monthly report, 10bis issues ONE invoice per legal entity, not per
 * branch. Its ₪3,658.00 matches the combined entity report's commission
 * (₪3,658.04) to the agora. Splitting it pro-rata by the same ratio already
 * used for the report (fix-azrieli-entity-july-2026.ts) keeps both sides of
 * each franchisee's reconciliation consistent:
 *     ויני עזריאלי  19,233.55 / 30,132  → 64.14%
 *     נתנזון        10,898.45 / 30,132  → 35.86%
 * Approved by Asaf, 2026-08-11.
 *
 * NOT covered — 10bis never sent a July invoice for קינג קונג חורב or
 * קינג קונג מוצקין. Those have to be chased with 10bis; nothing is parked in
 * our queue for them.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/fix-tenbis-invoices-july-2026.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import {
  client,
  clientDocument,
  franchisee,
  inboundReviewQueue,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";

const YEAR = 2026;

/** June's invoice, mis-filed into the July slot. */
const MISFILED = {
  fileName: "tenbis-invoice-Y2X1KOZUF1EQ2HBTU.pdf",
  amount: 2578.01,
  franchisee: "ויני עזריאלי חיפה",
};

/** קסטרא's July invoice — single franchisee, parked in the review queue. */
const KASTRA = {
  queueId: "fb0d9f7d-11e8-41e2-ab81-98ba29ef2150",
  amount: 2241,
  franchisee: "קסטרא טומאיי בע\"מ",
};

/** The Azrieli ENTITY invoice — one document, two franchisees. */
const AZRIELI = {
  queueId: "67edd42e-e672-42ee-9f18-4017970f97b1",
  amount: 3658,
  // Same ratio the entity REPORT was split by, so both sides agree.
  split: [
    { franchisee: "ויני עזריאלי חיפה", reportShare: 19233.55 },
    { franchisee: "נתנזון עזריאלי חיפה", reportShare: 10898.45 },
  ],
  reportTotal: 30132,
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

async function main() {
  const apply = process.argv.includes("--apply");
  const log = console.log;

  const [tenbis] = await database
    .select({ id: client.id })
    .from(client)
    .where(eq(client.code, "TENBIS"));
  if (!tenbis) throw new Error("TENBIS client not found");

  const branches = await database
    .select({ id: franchisee.id, name: franchisee.name })
    .from(franchisee);
  const idOf = (name: string): string => {
    const f = branches.find((b) => b.name === name);
    if (!f) throw new Error(`franchisee not found: ${name}`);
    return f.id;
  };

  const invoiceSlot = (franchiseeId: string, month: number) =>
    and(
      eq(clientDocument.clientId, tenbis.id),
      eq(clientDocument.franchiseeId, franchiseeId),
      eq(clientDocument.documentType, "commission_invoice"),
      eq(clientDocument.periodMonth, month),
      eq(clientDocument.periodYear, YEAR),
    );

  // Slots that STEP 1 frees. In a dry run nothing is written, so without this
  // the checks below would report a false conflict on ויני עזריאלי's July slot
  // and the dry run would not match what --apply actually does.
  const freedJulySlots = new Set<string>();

  // ─── STEP 1: move June's invoice out of the July slot ──────────────────
  log("STEP 1 — move 500113385 from July to June");
  const viniId = idOf(MISFILED.franchisee);
  const [misfiled] = await database
    .select({
      id: clientDocument.id,
      totalAmount: clientDocument.totalAmount,
      periodMonth: clientDocument.periodMonth,
    })
    .from(clientDocument)
    .where(
      and(invoiceSlot(viniId, 7), eq(clientDocument.originalFileName, MISFILED.fileName)),
    );

  if (!misfiled) {
    log("  ⚠ not in the July slot — already moved?");
  } else {
    const [juneOccupant] = await database
      .select({ id: clientDocument.id, fn: clientDocument.originalFileName })
      .from(clientDocument)
      .where(invoiceSlot(viniId, 6));
    if (juneOccupant) {
      log(`  ✗ June slot already holds ${juneOccupant.fn}. Aborting — inspect by hand.`);
      process.exit(1);
    }
    log(`  ${misfiled.id}  ₪${misfiled.totalAmount}  July → June`);
    freedJulySlots.add(viniId);
    if (apply) {
      await database
        .update(clientDocument)
        .set({
          periodMonth: 6,
          reviewNotes:
            `הועברה מיולי ליוני: חשבונית 500113385 מתאריך 16/07/2026 מכסה את יוני ` +
            `(10ביס מנפיקה באמצע החודש עבור החודש הקודם). התיוג השגוי חסם את ` +
            `חשבונית יולי האמיתית (400183172). תוקן 2026-08-11.`,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(clientDocument.id, misfiled.id));
      log("  ✓ moved");
    }
  }

  // ─── STEP 2 + 3: commit the parked July invoices ───────────────────────
  const queueIds = [KASTRA.queueId, AZRIELI.queueId];
  const parked = await database
    .select()
    .from(inboundReviewQueue)
    .where(eq(inboundReviewQueue.id, queueIds[0]));
  const parked2 = await database
    .select()
    .from(inboundReviewQueue)
    .where(eq(inboundReviewQueue.id, queueIds[1]));
  const rows = [...parked, ...parked2];
  if (rows.length !== 2) {
    log(`  ✗ expected 2 parked invoices, found ${rows.length}. Aborting.`);
    process.exit(1);
  }
  const kastraRow = rows.find((r) => r.id === KASTRA.queueId)!;
  const azrieliRow = rows.find((r) => r.id === AZRIELI.queueId)!;

  /** Insert (or refuse to overwrite) one July commission-invoice row. */
  async function commit(args: {
    franchiseeName: string;
    amount: number;
    source: typeof kastraRow;
    note: string;
  }): Promise<void> {
    const fId = idOf(args.franchiseeName);
    const [occupant] = await database
      .select({ id: clientDocument.id, fn: clientDocument.originalFileName })
      .from(clientDocument)
      .where(invoiceSlot(fId, 7));
    if (occupant && !freedJulySlots.has(fId)) {
      log(`  ✗ July slot for ${args.franchiseeName} holds ${occupant.fn}. Skipping.`);
      return;
    }
    log(`  → ${args.franchiseeName.padEnd(22)} ₪${args.amount}`);
    if (!apply) return;
    await database.insert(clientDocument).values({
      clientId: tenbis.id,
      franchiseeId: fId,
      documentType: "commission_invoice",
      source: "gmail_fetch",
      originalFileName: args.source.fileName ?? "tenbis-invoice.pdf",
      fileUrl: args.source.fileUrl,
      fileSize: args.source.fileSize,
      mimeType: args.source.mimeType,
      periodMonth: 7,
      periodYear: YEAR,
      processingStatus: "auto_approved",
      totalAmount: args.amount.toString(),
      commissionAmount: args.amount.toString(),
      netAmount: args.amount.toString(),
      reviewNotes: args.note,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  log("\nSTEP 2 — commit קסטרא's July invoice (400183008)");
  await commit({
    franchiseeName: KASTRA.franchisee,
    amount: KASTRA.amount,
    source: kastraRow,
    note:
      `שוחזרה מתור הסקירה: חשבונית 400183008 מתאריך 31/07/2026. ` +
      `תויגה בטעות כמאי — הפרסר זיהה "מאי" בתוך "קסטרא טומאיי" — ונדחתה ` +
      `מול חשבונית מאי האמיתית. תוקן 2026-08-11.`,
  });

  log("\nSTEP 3 — split the Azrieli entity invoice (400183172, ₪3,658)");
  let allocated = 0;
  for (let i = 0; i < AZRIELI.split.length; i++) {
    const part = AZRIELI.split[i];
    const share =
      i === AZRIELI.split.length - 1
        ? round2(AZRIELI.amount - allocated)
        : round2((AZRIELI.amount * part.reportShare) / AZRIELI.reportTotal);
    allocated = round2(allocated + share);
    const pct = ((part.reportShare / AZRIELI.reportTotal) * 100).toFixed(2);
    await commit({
      franchiseeName: part.franchisee,
      amount: share,
      source: azrieliRow,
      note:
        `חלק מחשבונית 10ביס ברמת הישות (400183172, ₪${AZRIELI.amount.toLocaleString("he-IL")}, 31/07/2026). ` +
        `10ביס מנפיקה חשבונית אחת לישות משפטית ולא לסניף — הסכום תואם את עמלת ` +
        `הדוח המאוחד (₪3,658.04). פוצל באותו יחס כמו הדוח: ` +
        `${part.reportShare.toLocaleString("he-IL")}/${AZRIELI.reportTotal.toLocaleString("he-IL")} = ${pct}% → ₪${share.toLocaleString("he-IL")}. ` +
        `אושר ע"י אסף, 2026-08-11.`,
    });
  }

  if (apply) {
    await database
      .update(inboundReviewQueue)
      .set({ status: "auto_committed", reviewedAt: new Date() })
      .where(eq(inboundReviewQueue.id, KASTRA.queueId));
    await database
      .update(inboundReviewQueue)
      .set({ status: "auto_committed", reviewedAt: new Date() })
      .where(eq(inboundReviewQueue.id, AZRIELI.queueId));
    log("\n✓ done — queue rows closed.");
  } else {
    log("\n(dry run — re-run with --apply to write)");
  }

  log(
    "\n⚠ still missing: 10bis sent NO July invoice for קינג קונג חורב or קינג קונג מוצקין.",
  );
  process.exit(0);
}

main();
