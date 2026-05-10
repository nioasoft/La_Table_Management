/**
 * One-off CLI: fix the HAAT income-invoice attribution for פט ויני /
 * נתנזון April 2026.
 *
 * Reut 2026-05-10 reported: HAAT for Vini Azrieli arrived but didn't
 * make it into the system. Investigation:
 *   - 10073 (₪2,549) and 10074 (₪3,148) — BOTH issued by the parent
 *     legal entity "פאט ויני עזריאלי בע\"מ" to Haat Delivery.
 *   - Both line items are generic ("סה\"כ אשראי חיוב במע\"מ") with no
 *     brand markers — content-based routing CANNOT distinguish them.
 *   - Tabit reconciliation reveals which is which:
 *       * Pat Vini Azrieli HAAT tabit_report = ₪2,549  → matches 10073
 *       * Natanzon Azrieli HAAT tabit_report = ₪3,148  → matches 10074
 *
 * What went wrong on 2026-05-05:
 *   1. 10073 forwarded email arrived 09:43:42 → ezcount link extracted
 *      → client_document INSERTED (parent → Natanzon by old rule)
 *   2. 10074 forwarded email arrived 09:43:54 (12 sec later) →
 *      processClientDocument's step-4c dedup-replace found existing
 *      (HAAT × Natanzon × 04/2026 × client_report) and OVERWROTE it
 *      with 10074's content. 10073 lost from DB; PDF orphaned in blob.
 *   3. 2026-05-10: today's reroute-vini-from-natanzon.ts moved the
 *      remaining row (10074) Natanzon → Pat Vini, mistakenly believing
 *      content-absence-of-Natanzon meant the doc was Pat Vini's.
 *
 * Correct end-state:
 *   - 10073 (₪2,549) → Pat Vini Azrieli Haifa client_report (NEW row;
 *     reads from existing orphan blob)
 *   - 10074 (₪3,148) → Natanzon Azrieli Haifa client_report (revert
 *     today's move on row 20b2201c)
 *
 * The parent-brand-map rule remains content-aware, which is correct for
 * documents that DO have brand markers. For brand-neutral parent
 * invoices (like these two), automatic routing is fundamentally
 * ambiguous — needs admin disambiguation. That UI is a separate task.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/recover-haat-10073-and-revert-10074.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { randomUUID } from "node:crypto";
import { database } from "@/db";
import { clientDocument } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { parseMishlohaFile } from "@/lib/client-parsers/invoice-mishloha-parser";

const HAAT_CLIENT_ID = "aed8c355-ddc8-47b9-891f-b9420d6b2dd4";
const PAT_VINI_AZRIELI_HAIFA_ID = "0e2a027a-18bb-4274-af4e-be451799a29b";
const NATANZON_AZRIELI_HAIFA_ID = "ab020323-fefe-4543-9a69-16d14dd54b99";

const ROW_10074_ID = "20b2201c-0cdd-4aec-b5a6-5e102d6fdadb";

// Orphan blob from 2026-05-02 forwarded email — the original 10073 PDF.
const BLOB_10073_URL =
  "https://l74vafifnsibeere.public.blob.vercel-storage.com/documents/client/aed8c355-ddc8-47b9-891f-b9420d6b2dd4/ezcount-29b74cc5-849e-4def-927f-a4211982333c_1777757514833_uib54r.pdf";
const BLOB_10073_FILENAME =
  "ezcount-29b74cc5-849e-4def-927f-a4211982333c_1777757514833_uib54r.pdf";
const BLOB_10073_SIZE = 94099;

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const apply = process.argv.includes("--apply");

  // ── Step 1: revert 10074 Pat Vini → Natanzon ────────────────────────
  console.log("── Step 1: revert 10074 (₪3,148) Pat Vini → Natanzon ──");

  const [existing10074] = await database
    .select({
      id: clientDocument.id,
      franchiseeId: clientDocument.franchiseeId,
      reviewNotes: clientDocument.reviewNotes,
      totalAmount: clientDocument.totalAmount,
    })
    .from(clientDocument)
    .where(eq(clientDocument.id, ROW_10074_ID))
    .limit(1);

  if (!existing10074) {
    console.log("  ↳ row 10074 not found — aborting");
    return;
  }
  if (existing10074.franchiseeId === NATANZON_AZRIELI_HAIFA_ID) {
    console.log("  ↳ already at Natanzon — skipping");
  } else if (existing10074.franchiseeId !== PAT_VINI_AZRIELI_HAIFA_ID) {
    console.log(
      `  ↳ unexpected franchisee ${existing10074.franchiseeId} — aborting`
    );
    return;
  } else {
    console.log(
      `  ↳ currently at Pat Vini, total=${existing10074.totalAmount}`
    );
    if (apply) {
      const note =
        "תיקון 2026-05-10 (חלק 2): הוחזר לנתנזון לאחר שהתגלה שהסכום ₪3,148 תואם ל-tabit_report של נתנזון (לא של פט ויני שהוא ₪2,549). " +
        'התיקון הקודם ב-reroute-vini-from-natanzon הניח בטעות שמסמך עם header "פאט ויני" ובלי אזכור "נתנזון" בתוכן שייך לפט ויני — אבל למסמכי הכנסה של HAAT שני הברנדים מנפיקים מ-אותה ישות משפטית בלי סימון תוכן.';
      const merged = existing10074.reviewNotes
        ? `${existing10074.reviewNotes}\n\n${note}`
        : note;
      await database
        .update(clientDocument)
        .set({
          franchiseeId: NATANZON_AZRIELI_HAIFA_ID,
          reviewNotes: merged,
          updatedAt: new Date(),
        })
        .where(eq(clientDocument.id, ROW_10074_ID));
      console.log("  ↳ MOVED 10074 → Natanzon");
    } else {
      console.log("  ↳ would move to Natanzon");
    }
  }

  // ── Step 2: insert recovered 10073 row for Pat Vini ─────────────────
  console.log("\n── Step 2: insert 10073 (₪2,549) at Pat Vini Azrieli Haifa ──");

  // Don't double-insert if a Pat Vini × HAAT × 04/2026 × client_report
  // already exists with the right amount (idempotency).
  const [maybeExisting] = await database
    .select({
      id: clientDocument.id,
      invoiceNumber: clientDocument.invoiceNumber,
      totalAmount: clientDocument.totalAmount,
    })
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.clientId, HAAT_CLIENT_ID),
        eq(clientDocument.franchiseeId, PAT_VINI_AZRIELI_HAIFA_ID),
        eq(clientDocument.periodMonth, 4),
        eq(clientDocument.periodYear, 2026),
        eq(clientDocument.documentType, "client_report")
      )
    )
    .limit(1);
  if (maybeExisting) {
    console.log(
      `  ↳ row already present (${maybeExisting.id}, invoice=${maybeExisting.invoiceNumber}, total=${maybeExisting.totalAmount}) — skipping insert`
    );
    if (!apply) console.log("\nDry-run done.");
    return;
  }

  const buffer = await downloadBuffer(BLOB_10073_URL);
  const result = await parseMishlohaFile(buffer, "application/pdf");
  if (!result.success || !result.data) {
    console.log(`  ↳ parser failed: ${result.errors.join(" | ")}`);
    return;
  }
  const data = result.data;
  if (
    data.periodMonth !== 4 ||
    data.periodYear !== 2026 ||
    Math.round(data.totalAmount) !== 2549
  ) {
    console.log(
      `  ↳ parsed values unexpected (period=${data.periodMonth}/${data.periodYear}, total=${data.totalAmount}) — aborting`
    );
    return;
  }
  console.log(
    `  ↳ parsed: invoice=${data.invoiceNumber}, total=${data.totalAmount}, period=${data.periodMonth}/${data.periodYear}`
  );

  if (!apply) {
    console.log("\nDry-run done. Pass --apply to write.");
    return;
  }

  const docId = randomUUID();
  await database.insert(clientDocument).values({
    id: docId,
    clientId: HAAT_CLIENT_ID,
    franchiseeId: PAT_VINI_AZRIELI_HAIFA_ID,
    documentType: "client_report",
    source: "gmail_fetch",
    originalFileName: BLOB_10073_FILENAME,
    fileUrl: BLOB_10073_URL,
    fileSize: BLOB_10073_SIZE,
    mimeType: "application/pdf",
    periodMonth: 4,
    periodYear: 2026,
    processingStatus: "auto_approved",
    processingResult: result as unknown as Record<string, unknown>,
    totalAmount: data.totalAmount.toString(),
    commissionAmount: data.commissionAmount.toString(),
    commissionRate: data.commissionRate.toString(),
    netAmount: data.netAmount.toString(),
    invoiceNumber: data.invoiceNumber ?? "10073",
    allocationNumber: data.allocationNumber ?? null,
    gmailMessageId: "recovered-2026-04-haat-10073-vini",
    reviewNotes:
      "שוחזר 2026-05-10: חשבונית הכנסה HAAT 10073 לפט ויני עזריאלי חיפה ל-04/2026. הקובץ הגיע 2026-05-02 דרך מייל מועבר, אבל נדרס ב-DB ע\"י 10074 12 שניות מאוחר יותר דרך dedup-replace. ה-PDF המקורי שרד ב-Vercel Blob.",
    updatedAt: new Date(),
  });
  console.log(`  ↳ INSERTED ${docId}`);
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
