/**
 * One-off CLI: repair the May 2026 HAAT + Mishloha documents for
 * פט ויני עזריאלי חיפה / נתנזון עזריאלי חיפה (Reut's 2026-06-11 report:
 * "פט ויני עזריאלי - לא נקלט דוח מהלקוח של משלוחה. בנוסף האט קלט פירוט
 * ולא דוח" / "לגבי נתנזון - לא קלט דוח של האט ומשלוחה").
 *
 * Root cause: both businesses run under one legal entity (פאט ויני
 * עזריאלי בע"מ, ח.פ 516161361). Every HAAT/Mishloha document resolved to
 * Pat Vini, and the (client, franchisee, period, type) dedup-replace let
 * each newer email DESTROY the previous document:
 *
 *   HAAT commission_invoice slot (doc f548cc8e) ate FOUR documents:
 *     EasyCount 10077 (06-02 10:46) → EasyCount 10078 (06-02 14:06)
 *     → חשבונית מרכזת SI266013289 (06-03 12:47) → SI266013298 (06-03 12:48)
 *   HAAT client_report slot (doc 50518c28): red summary 8093 (VINNI)
 *     overwritten by red 8095 (Natanzon Burger).
 *   MISHLOCHA commission_invoice slot (doc e6b36904): invoice 160782
 *     (VINNI line items) overwritten by 162041 (נתנזון בורגר line items).
 *
 * Attribution evidence (mathematically pinned by the red summaries):
 *   business 8093 VINNI:    sales 11,873 − cash 7,603 = 4,270.00 = invoice 10077 gross
 *                            expenses 2,665.83 ↔ SI266013289
 *   business 8095 Natanzon: sales 5,956 − cash 2,057 = 3,899.00 = invoice 10078 gross
 *                            expenses 1,478.05 ↔ SI266013298
 *   (Same method as the April 2026 fix in recover-haat-10073-and-revert-10074.ts.)
 *
 * End state this script writes (per Reut: the EasyCount invoice IS the
 * HAAT report; the red summary is irrelevant):
 *   Pat Vini  × HAAT      client_report      ← EasyCount 10077  (replaces red 8095 content on doc 50518c28)
 *   Natanzon  × HAAT      client_report      ← EasyCount 10078  (new row)
 *   Pat Vini  × HAAT      commission_invoice ← SI266013289      (replaces SI...298 content on doc f548cc8e)
 *   Natanzon  × HAAT      commission_invoice ← SI266013298      (new row)
 *   Pat Vini  × MISHLOCHA commission_invoice ← invoice 160782   (replaces 162041 content on doc e6b36904)
 *   Natanzon  × MISHLOCHA commission_invoice ← invoice 162041   (new row)
 *
 * NOT handled here (no source document ever arrived — external):
 *   MISHLOCHA client_report for both franchisees — the franchisee's
 *   ezcount account never emailed the "[העתק] חשבונית מס מאת..." copy.
 *
 * All source PDFs survived in Vercel Blob (inbound_review_queue.file_url).
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/fix-haat-mishloha-may-2026-vini-natanzon.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { randomUUID } from "node:crypto";
import { database } from "@/db";
import { clientDocument } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { parseMishlohaFile } from "@/lib/client-parsers/invoice-mishloha-parser";
import type { ClientDocumentProcessingResult } from "@/lib/client-parsers/types";

const HAAT_CLIENT_ID = "aed8c355-ddc8-47b9-891f-b9420d6b2dd4";
const MISHLOCHA_CLIENT_ID = "c668302f-16ce-449a-bb37-bfeb83b25232";
const PAT_VINI_ID = "0e2a027a-18bb-4274-af4e-be451799a29b";
const NATANZON_ID = "ab020323-fefe-4543-9a69-16d14dd54b99";
const PERIOD = { month: 5, year: 2026 };

const BLOB_BASE =
  "https://l74vafifnsibeere.public.blob.vercel-storage.com/documents/client";

interface Target {
  /** Human-readable label for logs */
  label: string;
  clientId: string;
  franchiseeId: string;
  franchiseeLabel: string;
  documentType: "client_report" | "commission_invoice";
  /** Existing doc to overwrite in place; undefined → insert a new row */
  existingDocId?: string;
  blobUrl: string;
  fileName: string;
  /** Synthetic-but-stable gmail key (original email id + suffix) */
  gmailMessageId: string;
  /** Expected gross total — abort the row if the parsed PDF disagrees */
  expectedTotal: number;
  reviewNote: string;
}

const NOTE_PREFIX =
  "שוחזר 2026-06-11 (תקרית ויני/נתנזון מאי 2026): שני העסקים חולקים ישות " +
  'משפטית אחת (ח.פ 516161361) וכל מסמכי HAAT/משלוחה נותבו לפט ויני, כשהמסמך ' +
  "האחרון דרס את קודמו. השיוך נקבע לפי הדוחות המסכמים של HAAT " +
  "(8093=VINNI, 8095=Natanzon Burger) והצלבת סכומים. ";

const TARGETS: Target[] = [
  {
    label: "HAAT client_report ← EasyCount 10077 (₪4,270)",
    clientId: HAAT_CLIENT_ID,
    franchiseeId: PAT_VINI_ID,
    franchiseeLabel: "פט ויני עזריאלי חיפה",
    documentType: "client_report",
    existingDocId: "50518c28-ce75-4f57-9540-1f19b46fd0e7", // currently red 8095
    blobUrl: `${BLOB_BASE}/${HAAT_CLIENT_ID}/ezcount-invoice_1780397196370_bawdzn.pdf`,
    fileName: "ezcount-invoice-10077.pdf",
    gmailMessageId: "da2fdb69-dbb1-4045-9fa3-76c4c5b196a2#recovered-10077",
    expectedTotal: 4270,
    reviewNote:
      NOTE_PREFIX +
      'חשבונית EasyCount 10077 (ויני, עסק 8093: מכירות 11,873 − מזומן 7,603 = 4,270). החליפה את הדוח האדום 8095 שהיה שייך בכלל לנתנזון.',
  },
  {
    label: "HAAT client_report ← EasyCount 10078 (₪3,899)",
    clientId: HAAT_CLIENT_ID,
    franchiseeId: NATANZON_ID,
    franchiseeLabel: "נתנזון עזריאלי חיפה",
    documentType: "client_report",
    blobUrl: `${BLOB_BASE}/${HAAT_CLIENT_ID}/ezcount-invoice_1780409213932_02x1q7.pdf`,
    fileName: "ezcount-invoice-10078.pdf",
    gmailMessageId: "8e0e8880-9569-420d-80d8-86e4fbbea36d#recovered-10078",
    expectedTotal: 3899,
    reviewNote:
      NOTE_PREFIX +
      "חשבונית EasyCount 10078 (נתנזון בורגר, עסק 8095: מכירות 5,956 − מזומן 2,057 = 3,899).",
  },
  {
    label: "HAAT commission_invoice ← SI266013289 (₪2,665.83)",
    clientId: HAAT_CLIENT_ID,
    franchiseeId: PAT_VINI_ID,
    franchiseeLabel: "פט ויני עזריאלי חיפה",
    documentType: "commission_invoice",
    existingDocId: "f548cc8e-5e8a-4115-8d34-85f061f6cf3d", // currently SI...298
    blobUrl: `${BLOB_BASE}/${HAAT_CLIENT_ID}/__________________________________-_05_2026__SI266_1780490864238_77mls6.pdf`,
    fileName:
      "(מסמך ממוחשב) הדפסת חשבונית מרכזת - 05.2026 ,SI266013289 חוד.pdf",
    gmailMessageId: "a6a7aac8-5fca-4b54-8ca9-ad1888bc6a6f#recovered-si289",
    expectedTotal: 2665.83,
    reviewNote:
      NOTE_PREFIX +
      "חשבונית מרכזת SI266013289 (תואמת הוצאות 2,665.83 בדוח עסק 8093 VINNI). החליפה את SI266013298 ששייכת לנתנזון.",
  },
  {
    label: "HAAT commission_invoice ← SI266013298 (₪1,478.05)",
    clientId: HAAT_CLIENT_ID,
    franchiseeId: NATANZON_ID,
    franchiseeLabel: "נתנזון עזריאלי חיפה",
    documentType: "commission_invoice",
    blobUrl: `${BLOB_BASE}/${HAAT_CLIENT_ID}/__________________________________-_05_2026__SI266_1780490902458_iw99cd.pdf`,
    fileName:
      "(מסמך ממוחשב) הדפסת חשבונית מרכזת - 05.2026 ,SI266013298 חוד.pdf",
    gmailMessageId: "b1005e6f-57c0-4f67-b1bd-b0df7adb696f#recovered-si298",
    expectedTotal: 1478.05,
    reviewNote:
      NOTE_PREFIX +
      "חשבונית מרכזת SI266013298 (תואמת הוצאות 1,478.05 בדוח עסק 8095 Natanzon Burger).",
  },
  {
    label: "MISHLOCHA commission_invoice ← 160782 (VINNI)",
    clientId: MISHLOCHA_CLIENT_ID,
    franchiseeId: PAT_VINI_ID,
    franchiseeLabel: "פט ויני עזריאלי חיפה",
    documentType: "commission_invoice",
    existingDocId: "e6b36904-ebda-4fec-9ccd-6f109bd7e35f", // currently 162041
    blobUrl: `${BLOB_BASE}/${MISHLOCHA_CLIENT_ID}/ezcount-invoice_1780376481074_76ismo.pdf`,
    fileName: "ezcount-invoice-160782.pdf",
    gmailMessageId: "15f8cb67-99b6-4ecc-9390-566c2b5098ad#recovered-160782",
    expectedTotal: NaN, // verified by line-item brand instead (VINNI)
    reviewNote:
      NOTE_PREFIX +
      'חשבונית משלוחה 160782 — כל השורות "VINNI ויני חיפה". החליפה את 162041 ששורותיה "נתנזון בורגר חיפה".',
  },
  {
    label: "MISHLOCHA commission_invoice ← 162041 (נתנזון בורגר)",
    clientId: MISHLOCHA_CLIENT_ID,
    franchiseeId: NATANZON_ID,
    franchiseeLabel: "נתנזון עזריאלי חיפה",
    documentType: "commission_invoice",
    blobUrl: `${BLOB_BASE}/${MISHLOCHA_CLIENT_ID}/ezcount-invoice_1780395879834_1kinh9.pdf`,
    fileName: "ezcount-invoice-162041.pdf",
    gmailMessageId: "1ed7d46d-24c9-48d0-8166-44a3fdabcef4#recovered-162041",
    expectedTotal: NaN, // verified by line-item brand instead (נתנזון בורגר)
    reviewNote:
      NOTE_PREFIX +
      'חשבונית משלוחה 162041 — כל השורות "נתנזון בורגר חיפה".',
  },
];

/** Brand markers each Mishloha invoice must / must not contain. */
const MISHLOHA_BRAND_CHECK: Record<string, { must: string; mustNot: string }> =
  {
    "ezcount-invoice-160782.pdf": { must: "VINNI", mustNot: "נתנזון בורגר" },
    "ezcount-invoice-162041.pdf": { must: "נתנזון בורגר", mustNot: "VINNI" },
  };

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function rawTextOf(result: ClientDocumentProcessingResult): string {
  return [
    result.data?.rawText ?? "",
    ...(result.data?.lineItems ?? []).map((li) => li.description ?? ""),
  ].join("\n");
}

async function main() {
  const apply = process.argv.includes("--apply");
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const target of TARGETS) {
    console.log(`\n── ${target.label} → ${target.franchiseeLabel} ──`);

    // 1. Download + parse the source PDF.
    const buffer = await downloadBuffer(target.blobUrl);
    const result = await parseMishlohaFile(buffer, "application/pdf");
    if (!result.success || !result.data) {
      console.log(`  ↳ FAILED to parse: ${result.errors.join(" | ")}`);
      failed++;
      continue;
    }
    const data = result.data;
    console.log(
      `  ↳ parsed: invoice=${data.invoiceNumber ?? "?"}, total=${data.totalAmount}, period=${data.periodMonth}/${data.periodYear}`
    );

    // 2. Sanity gates: period + expected total / brand marker.
    // SI (חשבונית מרכזת) PDFs carry no parseable period — the live pipeline
    // takes it from the email subject ("05.2026"). Only enforce equality
    // when the parser actually extracted a period.
    const parsedPeriod =
      data.periodMonth !== undefined && data.periodYear !== undefined;
    if (
      parsedPeriod &&
      (data.periodMonth !== PERIOD.month || data.periodYear !== PERIOD.year)
    ) {
      console.log(
        `  ↳ FAILED: parsed period ${data.periodMonth}/${data.periodYear} ≠ ${PERIOD.month}/${PERIOD.year}`
      );
      failed++;
      continue;
    }
    if (!Number.isNaN(target.expectedTotal)) {
      const diff = Math.abs(data.totalAmount - target.expectedTotal);
      if (diff > 1) {
        console.log(
          `  ↳ FAILED: parsed total ${data.totalAmount} ≠ expected ${target.expectedTotal}`
        );
        failed++;
        continue;
      }
    }
    const brandCheck = MISHLOHA_BRAND_CHECK[target.fileName];
    if (brandCheck) {
      const text = rawTextOf(result);
      if (!text.includes(brandCheck.must) || text.includes(brandCheck.mustNot)) {
        console.log(
          `  ↳ FAILED: brand markers mismatch (need "${brandCheck.must}", forbid "${brandCheck.mustNot}")`
        );
        failed++;
        continue;
      }
      console.log(`  ↳ brand marker verified: "${brandCheck.must}"`);
    }

    // 3. Idempotency / target row lookup.
    const docData = {
      clientId: target.clientId,
      franchiseeId: target.franchiseeId,
      documentType: target.documentType,
      source: "gmail_fetch" as const,
      originalFileName: target.fileName,
      fileUrl: target.blobUrl,
      fileSize: buffer.length,
      mimeType: "application/pdf",
      periodMonth: PERIOD.month,
      periodYear: PERIOD.year,
      processingStatus: "auto_approved" as const,
      processingResult: result as unknown as Record<string, unknown>,
      totalAmount: data.totalAmount.toString(),
      commissionAmount: data.commissionAmount?.toString() ?? null,
      commissionRate: data.commissionRate?.toString() ?? null,
      netAmount: data.netAmount?.toString() ?? null,
      invoiceNumber: data.invoiceNumber ?? null,
      allocationNumber: data.allocationNumber ?? null,
      gmailMessageId: target.gmailMessageId,
      reviewNotes: target.reviewNote,
      updatedAt: new Date(),
    };

    if (target.existingDocId) {
      const [existing] = await database
        .select({
          id: clientDocument.id,
          gmailMessageId: clientDocument.gmailMessageId,
          totalAmount: clientDocument.totalAmount,
          originalFileName: clientDocument.originalFileName,
        })
        .from(clientDocument)
        .where(eq(clientDocument.id, target.existingDocId))
        .limit(1);
      if (!existing) {
        console.log(`  ↳ FAILED: existing doc ${target.existingDocId} not found`);
        failed++;
        continue;
      }
      if (existing.gmailMessageId === target.gmailMessageId) {
        console.log(`  ↳ already recovered (gmail key matches) — skipping`);
        skipped++;
        continue;
      }
      console.log(
        `  ↳ will OVERWRITE doc ${existing.id} (currently "${existing.originalFileName}", total=${existing.totalAmount})`
      );
      if (apply) {
        await database
          .update(clientDocument)
          .set(docData)
          .where(eq(clientDocument.id, target.existingDocId));
        console.log(`  ↳ UPDATED ${target.existingDocId}`);
      }
      ok++;
    } else {
      const [collision] = await database
        .select({
          id: clientDocument.id,
          gmailMessageId: clientDocument.gmailMessageId,
        })
        .from(clientDocument)
        .where(
          and(
            eq(clientDocument.clientId, target.clientId),
            eq(clientDocument.franchiseeId, target.franchiseeId),
            eq(clientDocument.periodMonth, PERIOD.month),
            eq(clientDocument.periodYear, PERIOD.year),
            eq(clientDocument.documentType, target.documentType)
          )
        )
        .limit(1);
      if (collision) {
        if (collision.gmailMessageId === target.gmailMessageId) {
          console.log(`  ↳ already recovered (row ${collision.id}) — skipping`);
          skipped++;
        } else {
          console.log(
            `  ↳ FAILED: slot already occupied by ${collision.id} (email=${collision.gmailMessageId}) — resolve manually`
          );
          failed++;
        }
        continue;
      }
      const newId = randomUUID();
      console.log(`  ↳ will INSERT new row for ${target.franchiseeLabel}`);
      if (apply) {
        await database
          .insert(clientDocument)
          .values({ id: newId, ...docData });
        console.log(`  ↳ INSERTED ${newId}`);
      }
      ok++;
    }
  }

  console.log(
    `\n${apply ? "Done" : "Dry-run done"}: ${ok} written, ${skipped} skipped, ${failed} failed.${apply ? "" : " Pass --apply to write."}`
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
