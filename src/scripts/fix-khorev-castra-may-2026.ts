/**
 * One-off CLI: repair the May 2026 collateral damage for קינג קונג חורב
 * and קסטרא טומאיי — same root cause as the Vini/Natanzon incident
 * (fix-haat-mishloha-may-2026-vini-natanzon.ts), discovered during it.
 *
 * Each franchisee issues ALL its invoices from one ezcount account with a
 * single running sequence — some to משלוחה, some to Haat Delivery — and
 * every "[העתק] חשבונית מס ... מאת <זכיין>" email is routed to the
 * MISHLOCHA client by sender. So a Haat-bound invoice can land in (and
 * overwrite) the Mishloha report slot.
 *
 * Verified by reading the PDFs ("לכבוד" line):
 *   חורב 10050 → לכבוד: משלוחה        ₪24,654.76  (the real Mishloha report)
 *   חורב 10051 → לכבוד: Haat Delivery  ₪25,901.00  (the HAAT report)
 *   קסטרא 10074 → לכבוד: Haat Delivery ₪30,410.00  (the HAAT report)
 *   קסטרא 10073 → לכבוד: משלוחה — already correct in its slot, untouched.
 *
 * Repairs:
 *  1. חורב × MISHLOCHA × client_report (doc ca630611): currently holds the
 *     HAAT invoice 10051 (overwrote 10050 on 06-02 10:46). Restore 10050.
 *  2. חורב × HAAT × client_report: currently the red summary 8091 (doc
 *     c1ac7c6f, irrelevant per Reut 2026-06-11). The real report is 10051,
 *     parked as income_invoice (doc 1f8d4335, interim fix 2026-06-07).
 *     Delete the red doc, re-type 1f8d4335 → client_report.
 *  3. קסטרא × HAAT × client_report (doc a8f669c3): currently the red
 *     summary 8094. Replace content with EasyCount invoice 10074 (blob
 *     survived in inbound_review_queue row b13e1393).
 *
 * No May 2026 reconciliation approvals exist for these franchisees on
 * HAAT/MISHLOCHA (verified 2026-06-11) — safe to rewrite.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/fix-khorev-castra-may-2026.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { clientDocument } from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseMishlohaFile } from "@/lib/client-parsers/invoice-mishloha-parser";

const BLOB_BASE =
  "https://l74vafifnsibeere.public.blob.vercel-storage.com/documents/client";
const MISHLOCHA_CLIENT_ID = "c668302f-16ce-449a-bb37-bfeb83b25232";
const HAAT_CLIENT_ID = "aed8c355-ddc8-47b9-891f-b9420d6b2dd4";

const KHOREV_MISHLOHA_DOC = "ca630611-be89-4c4e-b45d-b45a1503ade4"; // holds 10051, should hold 10050
const KHOREV_HAAT_RED_DOC = "c1ac7c6f-5d68-4e9e-8854-53dc3fe33b4e"; // red 8091 → delete
const KHOREV_HAAT_INVOICE_DOC = "1f8d4335-ac07-4a87-a76d-f7801829bc25"; // income_invoice 10051 → client_report
const CASTRA_HAAT_RED_DOC = "a8f669c3-b6f6-4c46-b423-1ebd73125a62"; // red 8094 → replace with 10074

const BLOB_10050 = `${BLOB_BASE}/${MISHLOCHA_CLIENT_ID}/ezcount-b794b5a6-6dd3-4fcc-b66a-c08af26719c7_1780352586062_p51pdv.pdf`;
const BLOB_10074 = `${BLOB_BASE}/${HAAT_CLIENT_ID}/ezcount-invoice_1780397205665_a5ylw9.pdf`;

const GMAIL_KEY_10050 = "recovered-2026-05-mishloha-10050-khorev";
const GMAIL_KEY_10074 = "recovered-2026-05-haat-10074-castra";

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function parseAndVerify(args: {
  blobUrl: string;
  expectedInvoice: string;
  expectedTotal: number;
  expectedIssuerToken: string;
}) {
  const buffer = await downloadBuffer(args.blobUrl);
  const result = await parseMishlohaFile(buffer, "application/pdf");
  if (!result.success || !result.data) {
    throw new Error(`parse failed: ${result.errors.join(" | ")}`);
  }
  const d = result.data;
  if ((d.invoiceNumber ?? "") !== args.expectedInvoice) {
    throw new Error(
      `invoice mismatch: parsed ${d.invoiceNumber} ≠ expected ${args.expectedInvoice}`
    );
  }
  if (Math.abs(d.totalAmount - args.expectedTotal) > 1) {
    throw new Error(
      `total mismatch: parsed ${d.totalAmount} ≠ expected ${args.expectedTotal}`
    );
  }
  if (!d.franchiseeName?.includes(args.expectedIssuerToken)) {
    throw new Error(
      `issuer mismatch: parsed "${d.franchiseeName}" missing "${args.expectedIssuerToken}"`
    );
  }
  console.log(
    `  ↳ verified: invoice=${d.invoiceNumber}, total=${d.totalAmount}, issuer="${d.franchiseeName}", period=${d.periodMonth}/${d.periodYear}`
  );
  return { buffer, result, data: d };
}

async function main() {
  const apply = process.argv.includes("--apply");

  // ── 1. חורב MISHLOCHA client_report ← invoice 10050 ─────────────────
  console.log("── 1. חורב × משלוחה: שחזור חשבונית 10050 ──");
  const [khorevMish] = await database
    .select({
      id: clientDocument.id,
      invoiceNumber: clientDocument.invoiceNumber,
      gmailMessageId: clientDocument.gmailMessageId,
    })
    .from(clientDocument)
    .where(eq(clientDocument.id, KHOREV_MISHLOHA_DOC))
    .limit(1);
  if (!khorevMish) {
    console.log("  ↳ doc not found — aborting step");
  } else if (khorevMish.gmailMessageId === GMAIL_KEY_10050) {
    console.log("  ↳ already recovered — skipping");
  } else {
    console.log(
      `  ↳ current content: invoice=${khorevMish.invoiceNumber} (the HAAT-bound 10051)`
    );
    const v = await parseAndVerify({
      blobUrl: BLOB_10050,
      expectedInvoice: "10050",
      expectedTotal: 24654.76,
      expectedIssuerToken: "חורב",
    });
    if (apply) {
      await database
        .update(clientDocument)
        .set({
          originalFileName: "ezcount-invoice-10050.pdf",
          fileUrl: BLOB_10050,
          fileSize: v.buffer.length,
          mimeType: "application/pdf",
          processingResult: v.result as unknown as Record<string, unknown>,
          totalAmount: v.data.totalAmount.toString(),
          commissionAmount: v.data.commissionAmount?.toString() ?? null,
          commissionRate: v.data.commissionRate?.toString() ?? null,
          netAmount: v.data.netAmount?.toString() ?? null,
          invoiceNumber: "10050",
          allocationNumber: v.data.allocationNumber ?? null,
          gmailMessageId: GMAIL_KEY_10050,
          reviewNotes:
            "שוחזר 2026-06-11: דוח משלוחה האמיתי של חורב הוא חשבונית 10050 " +
            '(לכבוד: משלוחה, ₪24,654.76). חשבונית 10051 שישבה כאן הוצאה ל-Haat Delivery ' +
            'ונקלטה בטעות במשבצת משלוחה כי כל מיילי "[העתק] מאת הזכיין" מנותבים למשלוחה לפי שולח.',
          updatedAt: new Date(),
        })
        .where(eq(clientDocument.id, KHOREV_MISHLOHA_DOC));
      console.log("  ↳ UPDATED");
    } else {
      console.log("  ↳ would update with 10050");
    }
  }

  // ── 2. חורב HAAT: red 8091 out, invoice 10051 becomes the report ────
  console.log("\n── 2. חורב × HAAT: מחיקת הדוח האדום + 10051 → client_report ──");
  const [khorevRed] = await database
    .select({ id: clientDocument.id, originalFileName: clientDocument.originalFileName })
    .from(clientDocument)
    .where(eq(clientDocument.id, KHOREV_HAAT_RED_DOC))
    .limit(1);
  const [khorevInv] = await database
    .select({
      id: clientDocument.id,
      documentType: clientDocument.documentType,
      reviewNotes: clientDocument.reviewNotes,
    })
    .from(clientDocument)
    .where(eq(clientDocument.id, KHOREV_HAAT_INVOICE_DOC))
    .limit(1);
  if (!khorevInv) {
    console.log("  ↳ income_invoice doc not found — aborting step");
  } else if (khorevInv.documentType === "client_report") {
    console.log("  ↳ already re-typed — skipping");
  } else {
    if (khorevRed) {
      console.log(`  ↳ will DELETE red summary doc ${khorevRed.id} ("${khorevRed.originalFileName}")`);
    }
    console.log(
      `  ↳ will re-type ${khorevInv.id} ${khorevInv.documentType} → client_report`
    );
    if (apply) {
      if (khorevRed) {
        await database
          .delete(clientDocument)
          .where(eq(clientDocument.id, KHOREV_HAAT_RED_DOC));
        console.log("  ↳ DELETED red summary");
      }
      const note =
        'סווג מחדש 2026-06-11: לפי רעות חשבונית ה-EasyCount היא "הדוח" של HAAT ' +
        "והדוח האדום אינו רלוונטי — הועבר income_invoice → client_report והדוח האדום 8091 נמחק.";
      await database
        .update(clientDocument)
        .set({
          documentType: "client_report",
          reviewNotes: khorevInv.reviewNotes
            ? `${khorevInv.reviewNotes}\n\n${note}`
            : note,
          updatedAt: new Date(),
        })
        .where(eq(clientDocument.id, KHOREV_HAAT_INVOICE_DOC));
      console.log("  ↳ RE-TYPED to client_report");
    }
  }

  // ── 3. קסטרא HAAT client_report ← invoice 10074 ─────────────────────
  console.log("\n── 3. קסטרא × HAAT: שחזור חשבונית 10074 על הדוח האדום ──");
  const [castraRed] = await database
    .select({
      id: clientDocument.id,
      originalFileName: clientDocument.originalFileName,
      gmailMessageId: clientDocument.gmailMessageId,
    })
    .from(clientDocument)
    .where(eq(clientDocument.id, CASTRA_HAAT_RED_DOC))
    .limit(1);
  if (!castraRed) {
    console.log("  ↳ doc not found — aborting step");
  } else if (castraRed.gmailMessageId === GMAIL_KEY_10074) {
    console.log("  ↳ already recovered — skipping");
  } else {
    console.log(`  ↳ current content: "${castraRed.originalFileName}" (red 8094)`);
    const v = await parseAndVerify({
      blobUrl: BLOB_10074,
      expectedInvoice: "10074",
      expectedTotal: 30410,
      expectedIssuerToken: "קסטרא",
    });
    if (apply) {
      await database
        .update(clientDocument)
        .set({
          originalFileName: "ezcount-invoice-10074.pdf",
          fileUrl: BLOB_10074,
          fileSize: v.buffer.length,
          mimeType: "application/pdf",
          processingResult: v.result as unknown as Record<string, unknown>,
          totalAmount: v.data.totalAmount.toString(),
          commissionAmount: v.data.commissionAmount?.toString() ?? null,
          commissionRate: v.data.commissionRate?.toString() ?? null,
          netAmount: v.data.netAmount?.toString() ?? null,
          invoiceNumber: "10074",
          allocationNumber: v.data.allocationNumber ?? null,
          gmailMessageId: GMAIL_KEY_10074,
          reviewNotes:
            "שוחזר 2026-06-11: דוח ה-HAAT האמיתי של קסטרא הוא חשבונית EasyCount 10074 " +
            "(לכבוד: Haat Delivery, ₪30,410). החשבונית נקלטה ב-06-02 ונדרסה ע\"י חשבונית " +
            "העמלה SI266013296 יום אחרי; הדוח האדום 8094 שישב כאן אינו בשימוש להתאמות.",
          updatedAt: new Date(),
        })
        .where(eq(clientDocument.id, CASTRA_HAAT_RED_DOC));
      console.log("  ↳ UPDATED");
    } else {
      console.log("  ↳ would update with 10074");
    }
  }

  console.log(`\n${apply ? "Done." : "Dry-run done. Pass --apply to write."}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
