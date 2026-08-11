/**
 * One-off CLI: restore the second half of קינג קונג מוצקין's July 2026 Wolt month.
 *
 * Background (audit 2026-08-11):
 * Wolt split מוצקין's July payout into two reports instead of the usual single
 * monthly one:
 *
 *   01/07–16/07  |_sales_report_semi_monthly_2026-07-01_2026-07-16.pdf   ₪97,869
 *   16/07–01/08  |_sales_report_custom_2026-07-16_2026-08-01.pdf         ₪114,404
 *
 * `client_document` holds exactly one client_report per (client, franchisee,
 * month) — enforced by the partial unique index `idx_client_doc_unique_report`
 * — so when the second report arrived on 2026-08-01 the overwrite guard in
 * client-document-processor.ts refused it and parked it in the review queue as
 * `failed` (row 627f2977-fcca-4c8b-9b91-043b0a63b833). Nobody worked the queue,
 * so July's stored Wolt figure stayed at ₪97,869 — 54% of the real month.
 *
 * Corroboration: the two halves sum to ₪212,273; Tabit independently reports
 * ₪212,266 for the same (franchisee, client, month). ₪7 apart.
 *
 * This script sets the stored client_report to the full-month total and records
 * why in reviewNotes, so the number is not mistaken for parser output.
 *
 * NOT fixed here — the commission side:
 * Both Wolt emails carried 4 attachments and only 1 reached the system in each
 * case, so the second half's Wolt commission invoice was never ingested at all.
 * The stored commission_invoice (₪24,652.46) covers 01–15/07 only. It is left
 * untouched: inventing it from the first half's effective rate would put a
 * fabricated number into billing. The consequence is intentional and visible —
 * `getInvoiceVerificationRows` computes expected commission as
 * reportTotalAmount × rate, so this franchisee will now surface as a `mismatch`
 * on the invoice-verification board until the real second-half invoice is
 * fetched (Resend email 6662cb52-6249-460f-bc30-3b20278bee34, or Hadas's backup
 * forward) and uploaded.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/fix-motzkin-wolt-july-2026.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { client, clientDocument, franchisee } from "@/db/schema";
import { and, eq, like } from "drizzle-orm";

const PERIOD_MONTH = 7;
const PERIOD_YEAR = 2026;

const FIRST_HALF_AMOUNT = 97869;
const SECOND_HALF_AMOUNT = 114404;
const FULL_MONTH_AMOUNT = FIRST_HALF_AMOUNT + SECOND_HALF_AMOUNT; // 212,273

/** The parked second-half report, kept in the note so the source is traceable. */
const SECOND_HALF_FILE = "|_sales_report_custom_2026-07-16_2026-08-01.pdf";
const SECOND_HALF_BLOB =
  "https://l74vafifnsibeere.public.blob.vercel-storage.com/documents/inbound-review/8eeead3c-a3fa-4564-b6a2-44d4cb25dc5c/__sales_report_custom_2026-07-16_2026-08-01_1785620309494_vkiknu.pdf";
const REVIEW_QUEUE_ROW = "627f2977-fcca-4c8b-9b91-043b0a63b833";

const NOTE = [
  `סכום מאוחד ידנית: ₪${FULL_MONTH_AMOUNT.toLocaleString("he-IL")} = ` +
    `₪${FIRST_HALF_AMOUNT.toLocaleString("he-IL")} (01–16/07) + ` +
    `₪${SECOND_HALF_AMOUNT.toLocaleString("he-IL")} (16/07–01/08).`,
  `Wolt פיצלה את יולי 2026 לשני דוחות. הדוח השני (${SECOND_HALF_FILE}) נדחה ` +
    `אוטומטית ב-01/08/2026 כי המערכת מחזיקה דוח אחד לחודש לכל זכיין, והוא נותר ` +
    `בתור הסקירה (${REVIEW_QUEUE_ROW}). קובץ המקור: ${SECOND_HALF_BLOB}`,
  `אימות: טאבית מדווחת ₪212,266 לאותה תקופה — פער ₪7.`,
  `⚠ חשבונית העמלה מכסה 01–15/07 בלבד (₪24,652.46). חשבונית החצי השני מעולם ` +
    `לא נקלטה, ולכן הזכיין יופיע כ"אי-התאמה" בלוח אימות החשבוניות עד שתועלה.`,
  `עודכן ידנית באודיט הצינור 2026-08-11 (fix-motzkin-wolt-july-2026.ts).`,
].join("\n");

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await database
    .select({
      id: clientDocument.id,
      fileName: clientDocument.originalFileName,
      totalAmount: clientDocument.totalAmount,
      commissionAmount: clientDocument.commissionAmount,
      reviewNotes: clientDocument.reviewNotes,
      franchiseeName: franchisee.name,
    })
    .from(clientDocument)
    .innerJoin(client, eq(client.id, clientDocument.clientId))
    .innerJoin(franchisee, eq(franchisee.id, clientDocument.franchiseeId))
    .where(
      and(
        eq(client.code, "WOLT"),
        eq(clientDocument.documentType, "client_report"),
        eq(clientDocument.periodMonth, PERIOD_MONTH),
        eq(clientDocument.periodYear, PERIOD_YEAR),
        like(franchisee.name, "%מוצקין%"),
      ),
    );

  if (rows.length !== 1) {
    console.error(
      `✗ expected exactly 1 WOLT client_report for מוצקין ${PERIOD_MONTH}/${PERIOD_YEAR}, found ${rows.length}. Aborting.`,
    );
    process.exit(1);
  }

  const doc = rows[0];
  const current = doc.totalAmount ? parseFloat(doc.totalAmount) : null;

  console.log(`franchisee : ${doc.franchiseeName}`);
  console.log(`document   : ${doc.id} (${doc.fileName})`);
  console.log(`current    : ₪${current?.toLocaleString("he-IL") ?? "—"}`);
  console.log(`new total  : ₪${FULL_MONTH_AMOUNT.toLocaleString("he-IL")}`);
  console.log(
    "commission : untouched — the commission_invoice document (01–15/07 only) is a separate row",
  );

  if (current === FULL_MONTH_AMOUNT) {
    console.log("\n✓ already merged — nothing to do.");
    process.exit(0);
  }

  if (current !== FIRST_HALF_AMOUNT) {
    console.error(
      `\n✗ current total (₪${current}) is neither the first half (₪${FIRST_HALF_AMOUNT}) nor the merged total. ` +
        `Something else changed this row — inspect it by hand before re-running.`,
    );
    process.exit(1);
  }

  if (!apply) {
    console.log("\n(dry run — re-run with --apply to write)");
    console.log(`\nnote to be written:\n${NOTE}`);
    process.exit(0);
  }

  await database
    .update(clientDocument)
    .set({
      totalAmount: FULL_MONTH_AMOUNT.toString(),
      reviewNotes: doc.reviewNotes ? `${doc.reviewNotes}\n\n${NOTE}` : NOTE,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(clientDocument.id, doc.id));

  console.log("\n✓ updated.");
  process.exit(0);
}

main();
