/**
 * One-off CLI: repair July 2026 for the shared Azrieli legal entity.
 *
 * Both fixes were surfaced by the new Tabit cross-check in the
 * email-pipeline-health cron (audit 2026-08-11).
 *
 * ── FIX 1 — TENBIS: one combined report, two restaurants ─────────────────
 * In May and June 2026, 10bis sent the entity TWO reports, one per branch:
 *   21657_2026MM.pdf → ויני עזריאלי חיפה   (May ₪12,945 / June ₪16,866.25)
 *   29896_2026MM.pdf → נתנזון עזריאלי חיפה (May ₪1,465  / June ₪3,989)
 * both matching Tabit within 2%.
 *
 * In July, 10bis changed format: a SINGLE entity-level PDF
 * (21657_20260701_20260731.pdf, "פט ויני עזריאלי בע''מ") containing two
 * restaurant sections — "פירוט עסקאות למסעדת ויני חיפה" and "פירוט עסקאות
 * למסעדת נתנזון בורגר שופ חיפה". No 29896 file arrived at all.
 *
 * The 10bis parser reads a single franchisee name per document, so it picked
 * up the LAST section header ("נתנזון בורגר שופ חיפה") and filed the whole
 * combined ₪30,132 onto נתנזון — against Tabit's ₪11,164 for that branch
 * (169.9% divergence), while ויני was left with no report at all.
 *
 * The split below is read from the PDF's own per-section day rows:
 *   ויני חיפה                 sales ₪20,560.60
 *   נתנזון בורגר שופ חיפה     sales ₪11,650.40
 *   sum                       ₪32,211.00  ← matches the PDF's stated
 *                                            "סה\"כ עסקאות 32,211 ש\"ח"
 *
 * `totalAmount` on a 10bis report stores the COMMISSION BASE ("סה\"כ עסקאות
 * לחישוב עמלה", ₪30,132), not gross sales — so the base is allocated
 * pro-rata by each section's own sales. The per-section commission column
 * (₪3,424.04) is NOT used: it falls ₪234 short of the entity's ₪3,658.04
 * because 10bis applies an entity-level adjustment that belongs to neither
 * branch, so it cannot allocate the base exactly.
 *
 * Both results land in the same 1.4–2.5% band against Tabit that May and
 * June did — independent corroboration that the split is right:
 *   ויני    ₪19,233.55  vs Tabit ₪19,725.50  (2.5%)
 *   נתנזון  ₪10,898.45  vs Tabit ₪11,164.00  (2.4%)
 *
 * Both rows point at the SAME source PDF, because there is only one — that
 * is the honest representation of a combined document.
 *
 * ⚠ GENERAL FIX STILL OWED: the 10bis report parser must detect multiple
 * "פירוט עסקאות למסעדת X" sections and emit one result per restaurant.
 * Until it does, every future month for this entity repeats this incident.
 * The Tabit cross-check will now catch it, but catching is not preventing.
 *
 * ── FIX 2 — MISHLOCHA: a commission invoice sitting in the report slot ───
 * נתנזון's July client_report is `Tax_Invoice_166992.pdf` (₪894.51, manual
 * upload) — but that is Mishloha's OWN tax invoice: the parser read its
 * issuer as "דיב אנד רד פרוג'קטס בע\"מ" (Mishloha's legal entity), and the
 * franchisee's commission_invoice row for the same month is the identical
 * document — same invoice number 166992, same ₪894.51, arrived by
 * gmail_fetch as `ezcount-invoice.pdf`.
 *
 * So the report slot holds a duplicate of the commission invoice: ₪894.51 of
 * "sales" against ₪5,375.40 of Tabit sales (83.4% divergence). The real
 * report — the franchisee-issued ezcount invoice to משלוחה — never arrived.
 * Deleting the mis-filed row restores the truth: no July report for this
 * franchisee, which the missing-pair alert will then report correctly.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/fix-azrieli-entity-july-2026.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { client, clientDocument, franchisee } from "@/db/schema";
import { and, eq } from "drizzle-orm";

const PERIOD_MONTH = 7;
const PERIOD_YEAR = 2026;

const COMBINED_FILE = "21657_20260701_20260731.pdf";
const ENTITY_COMMISSION_BASE = 30132;

/** Per-restaurant sales, summed from the PDF's own day rows. */
const VINI_SALES = 20560.6;
const NATANZON_SALES = 11650.4;
const TOTAL_SALES = VINI_SALES + NATANZON_SALES; // 32,211 — matches the PDF

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Pro-rata allocation of the entity commission base. */
const VINI_BASE = round2((ENTITY_COMMISSION_BASE * VINI_SALES) / TOTAL_SALES);
const NATANZON_BASE = round2(ENTITY_COMMISSION_BASE - VINI_BASE);

const MISFILED_MISHLOCHA_DOC = "45b2fde0-0fd2-4861-b4cd-1887ae7bc7ea";

function splitNote(branch: string, sales: number, base: number): string {
  return [
    `פוצל ידנית מדוח 10ביס מאוחד לישות פט ויני עזריאלי בע"מ (${COMBINED_FILE}).`,
    `ביולי 2026 10ביס עברה לדוח אחד לישות עם שתי מסעדות בפנים, במקום שני קבצים ` +
      `נפרדים כמו במאי-יוני (21657 = ויני, 29896 = נתנזון). הפרסר קורא שם זכיין ` +
      `אחד למסמך, לכן כל ₪${ENTITY_COMMISSION_BASE.toLocaleString("he-IL")} שויכו ` +
      `בטעות לנתנזון בלבד.`,
    `החלק של "${branch}": מכירות ₪${sales.toLocaleString("he-IL")} מתוך ` +
      `₪${TOTAL_SALES.toLocaleString("he-IL")} → בסיס עמלה ₪${base.toLocaleString("he-IL")} ` +
      `(פרו-רata מתוך ₪${ENTITY_COMMISSION_BASE.toLocaleString("he-IL")}).`,
    `שני הזכיינים מצביעים על אותו PDF — יש רק אחד.`,
    `תוקן באודיט הצינור 2026-08-11 (fix-azrieli-entity-july-2026.ts).`,
  ].join("\n");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const log = (s: string) => console.log(s);

  // ─── Resolve the players ──────────────────────────────────────────────
  const [tenbis] = await database
    .select({ id: client.id })
    .from(client)
    .where(eq(client.code, "TENBIS"));
  if (!tenbis) throw new Error("TENBIS client not found");

  const branches = await database
    .select({ id: franchisee.id, name: franchisee.name })
    .from(franchisee);
  const vini = branches.find((f) => f.name === "ויני עזריאלי חיפה");
  const natanzon = branches.find((f) => f.name === "נתנזון עזריאלי חיפה");
  if (!vini || !natanzon) throw new Error("Azrieli franchisees not found");

  // ─── FIX 1: the combined 10bis report ─────────────────────────────────
  const [combined] = await database
    .select()
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.clientId, tenbis.id),
        eq(clientDocument.documentType, "client_report"),
        eq(clientDocument.periodMonth, PERIOD_MONTH),
        eq(clientDocument.periodYear, PERIOD_YEAR),
        eq(clientDocument.originalFileName, COMBINED_FILE),
      ),
    );

  if (!combined) {
    log(`⚠ FIX 1 skipped — ${COMBINED_FILE} not found (already fixed?)`);
  } else {
    const current = combined.totalAmount ? parseFloat(combined.totalAmount) : null;
    log("FIX 1 — TENBIS combined 10bis report");
    log(`  source doc   : ${combined.id} (on ${combined.franchiseeId === natanzon.id ? "נתנזון" : "?"})`);
    log(`  current      : ₪${current?.toLocaleString("he-IL")}`);
    log(`  → נתנזון      : ₪${NATANZON_BASE.toLocaleString("he-IL")}  (update in place)`);
    log(`  → ויני        : ₪${VINI_BASE.toLocaleString("he-IL")}  (new row, same PDF)`);

    if (current !== ENTITY_COMMISSION_BASE) {
      log(
        `  ✗ expected the combined ₪${ENTITY_COMMISSION_BASE} — found ₪${current}. Aborting FIX 1.`,
      );
      process.exit(1);
    }

    const [viniExisting] = await database
      .select({ id: clientDocument.id })
      .from(clientDocument)
      .where(
        and(
          eq(clientDocument.clientId, tenbis.id),
          eq(clientDocument.franchiseeId, vini.id),
          eq(clientDocument.documentType, "client_report"),
          eq(clientDocument.periodMonth, PERIOD_MONTH),
          eq(clientDocument.periodYear, PERIOD_YEAR),
        ),
      );
    if (viniExisting) {
      log(`  ✗ ויני already has a July client_report (${viniExisting.id}). Aborting FIX 1.`);
      process.exit(1);
    }

    if (apply) {
      await database
        .update(clientDocument)
        .set({
          totalAmount: NATANZON_BASE.toString(),
          reviewNotes: splitNote("נתנזון בורגר שופ חיפה", NATANZON_SALES, NATANZON_BASE),
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(clientDocument.id, combined.id));

      // Same PDF, second franchisee. gmailMessageId is deliberately left NULL:
      // it is uniquely indexed, and the original row keeps the real one.
      await database.insert(clientDocument).values({
        clientId: tenbis.id,
        franchiseeId: vini.id,
        documentType: "client_report",
        source: combined.source,
        originalFileName: combined.originalFileName,
        fileUrl: combined.fileUrl,
        fileSize: combined.fileSize,
        mimeType: combined.mimeType,
        periodMonth: PERIOD_MONTH,
        periodYear: PERIOD_YEAR,
        processingStatus: "auto_approved",
        processingResult: combined.processingResult,
        totalAmount: VINI_BASE.toString(),
        reviewNotes: splitNote("ויני חיפה", VINI_SALES, VINI_BASE),
        reviewedAt: new Date(),
        updatedAt: new Date(),
      });
      log("  ✓ split applied");
    }
  }

  // ─── FIX 2: the mis-filed Mishloha invoice ────────────────────────────
  const [misfiled] = await database
    .select({
      id: clientDocument.id,
      fileName: clientDocument.originalFileName,
      invoiceNumber: clientDocument.invoiceNumber,
      totalAmount: clientDocument.totalAmount,
      documentType: clientDocument.documentType,
    })
    .from(clientDocument)
    .where(eq(clientDocument.id, MISFILED_MISHLOCHA_DOC));

  log("\nFIX 2 — MISHLOCHA commission invoice in the report slot");
  if (!misfiled) {
    log("  ⚠ skipped — row not found (already deleted?)");
  } else if (
    misfiled.documentType !== "client_report" ||
    misfiled.invoiceNumber !== "166992"
  ) {
    log(`  ✗ row ${misfiled.id} is not the expected mis-filed report. Aborting FIX 2.`);
    process.exit(1);
  } else {
    log(`  delete ${misfiled.id} — ${misfiled.fileName} (₪${misfiled.totalAmount}, invoice ${misfiled.invoiceNumber})`);
    log("  reason: identical to נתנזון's commission_invoice row for the same month");
    if (apply) {
      await database.delete(clientDocument).where(eq(clientDocument.id, misfiled.id));
      log("  ✓ deleted");
    }
  }

  if (!apply) log("\n(dry run — re-run with --apply to write)");
  process.exit(0);
}

main();
