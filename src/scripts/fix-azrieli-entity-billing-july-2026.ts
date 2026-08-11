/**
 * One-off CLI: give the Azrieli entity's July 2026 10bis documents to the
 * entity, undoing the per-branch split.
 *
 * Decision (Asaf, 2026-08-11): "option A for ויני עזריאלי, because they are the
 * same entity." The stored amount must equal the number printed on the
 * document, and both July documents are issued at LEGAL-ENTITY level with no
 * per-branch breakdown:
 *
 *   invoice 10082          פאט ויני עזריאלי בע"מ → תן ביס    ₪30,132.00
 *     one line item, "ריכוז עסקאות עבור חודש 7/2026"
 *   commission invoice 400183172   10bis → the entity        ₪3,658.00
 *
 * Earlier fixes split both pro-rata across ויני עזריאלי and נתנזון so each
 * branch reconciled against its own Tabit. That made every row a share and no
 * row equal to any document — the objection this reverses.
 *
 * WHAT CHANGED AT 10BIS: through June it billed the two branches separately
 * (21657 → ויני, 29896 → נתנזון, each with its own report and amount). From
 * July it bills the entity once. This is their policy change, not a defect
 * here, so the representation follows the documents.
 *
 * CONSEQUENCE, accepted deliberately: נתנזון has no 10bis row for July while
 * still carrying ₪11,164 of Tabit sales, so it reads as "missing client"; and
 * ויני's ₪30,132 sits against ₪19,725 of its own Tabit, which the Tabit
 * divergence check in email-pipeline-health will flag. Both are the honest
 * picture of consolidated billing, not errors to suppress.
 *
 * Nothing is destroyed: the נתנזון rows point at the same shared files, which
 * stay on ויני's rows and in inbound_review_queue.
 *
 * Also corrects קינג קונג חדרה to the invoice's ₪25,064.00 (stored ₪25,064.10,
 * carried over from the transaction report).
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/fix-azrieli-entity-billing-july-2026.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { client, clientDocument, franchisee } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

const ENTITY = "ויני עזריאלי חיפה";
const SIBLING = "נתנזון עזריאלי חיפה";

/** Face values printed on the July documents. */
const INVOICE_TOTAL = 30132;
const ENTITY_COMMISSION = 3658.04; // report's own commission figure
const COMMISSION_INVOICE = 3658; // 400183172

const HADERA = { name: 'קינג קונג חדרה בע"מ', invoiceTotal: 25064 };

async function main() {
  const apply = process.argv.includes("--apply");

  const [tenbis] = await database
    .select({ id: client.id })
    .from(client)
    .where(eq(client.code, "TENBIS"));
  if (!tenbis) throw new Error("TENBIS client not found");

  const july = (name: string, type: "client_report" | "commission_invoice") =>
    database
      .select({
        id: clientDocument.id,
        fileName: clientDocument.originalFileName,
        totalAmount: clientDocument.totalAmount,
      })
      .from(clientDocument)
      .innerJoin(franchisee, eq(franchisee.id, clientDocument.franchiseeId))
      .where(
        and(
          eq(clientDocument.clientId, tenbis.id),
          eq(clientDocument.documentType, type),
          eq(clientDocument.periodMonth, 7),
          eq(clientDocument.periodYear, 2026),
          eq(franchisee.name, name),
        ),
      );

  // ─── 1. The entity keeps the whole invoice ────────────────────────────
  const [entityReport] = await july(ENTITY, "client_report");
  if (!entityReport) {
    console.error("✗ no July client_report for the entity. Aborting.");
    process.exit(1);
  }
  console.log(
    `entity report      ₪${entityReport.totalAmount} → ₪${INVOICE_TOTAL}  (${entityReport.fileName})`,
  );

  const [entityInvoice] = await july(ENTITY, "commission_invoice");
  if (entityInvoice) {
    console.log(
      `entity commission  ₪${entityInvoice.totalAmount} → ₪${COMMISSION_INVOICE}`,
    );
  }

  // ─── 2. The sibling branch has no 10bis documents this month ──────────
  const siblingDocs = [
    ...(await july(SIBLING, "client_report")),
    ...(await july(SIBLING, "commission_invoice")),
  ];
  for (const d of siblingDocs) {
    console.log(`remove ${SIBLING}  ₪${d.totalAmount}  (${d.fileName})`);
  }

  // ─── 3. Hadera to its invoice's face value ────────────────────────────
  const [hadera] = await july(HADERA.name, "client_report");
  if (hadera && parseFloat(hadera.totalAmount ?? "0") !== HADERA.invoiceTotal) {
    console.log(
      `${HADERA.name}  ₪${hadera.totalAmount} → ₪${HADERA.invoiceTotal}`,
    );
  }

  if (!apply) {
    console.log("\n(dry run — re-run with --apply to write)");
    process.exit(0);
  }

  const note =
    `10ביס עברה מיולי 2026 לחיוב מאוחד לישות פאט ויני עזריאלי בע"מ (ח.פ 516161361). ` +
    `חשבונית 10082 היא ₪${INVOICE_TOTAL.toLocaleString("he-IL")} לישות כולה, בשורה אחת ` +
    `("ריכוז עסקאות עבור חודש 7/2026") וללא פירוט לפי סניף — לכן הסכום כאן הוא סכום ` +
    `החשבונית במלואו, ולנתנזון עזריאלי אין מסמכי 10ביס לחודש זה. ` +
    `עד יוני 10ביס חייבה כל סניף בנפרד (21657 / 29896). ` +
    `נקבע ע"י אסף, 2026-08-11.`;

  await database
    .update(clientDocument)
    .set({
      totalAmount: INVOICE_TOTAL.toString(),
      commissionAmount: ENTITY_COMMISSION.toString(),
      netAmount: (INVOICE_TOTAL - ENTITY_COMMISSION).toFixed(2),
      commissionRate: (
        Math.round((ENTITY_COMMISSION / INVOICE_TOTAL) * 10000) / 100
      ).toString(),
      reviewNotes: note,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(clientDocument.id, entityReport.id));

  if (entityInvoice) {
    await database
      .update(clientDocument)
      .set({
        totalAmount: COMMISSION_INVOICE.toString(),
        commissionAmount: COMMISSION_INVOICE.toString(),
        netAmount: COMMISSION_INVOICE.toString(),
        reviewNotes: note,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(clientDocument.id, entityInvoice.id));
  }

  if (siblingDocs.length > 0) {
    await database.delete(clientDocument).where(
      inArray(
        clientDocument.id,
        siblingDocs.map((d) => d.id),
      ),
    );
  }

  if (hadera && parseFloat(hadera.totalAmount ?? "0") !== HADERA.invoiceTotal) {
    await database
      .update(clientDocument)
      .set({
        totalAmount: HADERA.invoiceTotal.toString(),
        updatedAt: new Date(),
      })
      .where(eq(clientDocument.id, hadera.id));
  }

  console.log("\n✓ done.");
  process.exit(0);
}

main();
