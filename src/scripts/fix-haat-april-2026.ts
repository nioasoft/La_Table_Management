/**
 * One-off CLI: clean up HAAT 04/2026 attribution.
 *
 * Issue 1 — three HAAT דווח sales reports (8091/8094/8095) were inserted
 * as commission_invoice by an over-eager filename heuristic in
 * recover-orphan-blobs.ts. They are NOT financial invoices — they are
 * HAAT's monthly activity summaries (gross sales, cash payments, etc.).
 * The corresponding ezcount-* rows (10049, 10072, 10074) already serve
 * as the franchisee's official client_report; the 8xxx rows are
 * redundant and pollute the commission_invoice slot.
 *
 * Issue 2 — the three real HAAT central commission invoices for
 * 04/2026 (SI266010410/0414/0417) are orphan blobs in storage. They
 * couldn't be inserted earlier because the unique constraint on
 * commission_invoice was occupied by the mis-classified 8xxx rows.
 *
 * Fix:
 *   1. DELETE 8091/8094/8095 client_document rows (3 rows)
 *   2. INSERT 3 SI* central commission invoices for the right
 *      franchisees, parsed from the orphan blobs
 *
 * Mapping (verified by inspecting "לכבוד" recipient + ח.פ. in each PDF):
 *   - SI266010410 ₪1,276  → פט ויני עזריאלי בע"מ        → Pat Vini Azrieli Haifa
 *   - SI266010414 ₪8,339  → קינג קונג חיפה בע"מ          → King Kong Horev
 *   - SI266010417 ₪12,333 → קסטרא טומאוי בע"מ            → Kastra Tomai
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/fix-haat-april-2026.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { randomUUID } from "node:crypto";
import { database } from "@/db";
import { clientDocument } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { parseMishlohaFile } from "@/lib/client-parsers/invoice-mishloha-parser";

const HAAT_CLIENT_ID = "aed8c355-ddc8-47b9-891f-b9420d6b2dd4";

// Rows to DELETE — three HAAT דווח sales summaries mis-classified as
// commission_invoice. Identified by `original_file_name LIKE '8091%'` etc.
const ROWS_TO_DELETE = [
  { id: "862d4bc6-5b07-48d6-a92a-13c688030894", file: "8091_he", reason: "King Kong Horev HAAT sales summary" },
  { id: "85b61665-9f79-43f8-827f-a94cd350f846", file: "8094_he", reason: "Kastra Tomai HAAT sales summary" },
  { id: "c7ae5193-1c68-4bb5-a695-8ac9b6b426bf", file: "8095_he", reason: "Natanzon Burger HAAT sales summary (mis-attributed to Pat Vini)" },
];

interface SiToInsert {
  blobUrl: string;
  blobFilename: string;
  blobSize: number;
  invoiceNumber: string;
  franchiseeId: string;
  franchiseeName: string;
}

const SI_TO_INSERT: SiToInsert[] = [
  {
    blobUrl:
      "https://l74vafifnsibeere.public.blob.vercel-storage.com/documents/client/aed8c355-ddc8-47b9-891f-b9420d6b2dd4/__________________________________-_04_2026__SI266_1777821788596_w96w08.pdf",
    blobFilename:
      "__________________________________-_04_2026__SI266_1777821788596_w96w08.pdf",
    blobSize: 86342,
    invoiceNumber: "266010410",
    franchiseeId: "0e2a027a-18bb-4274-af4e-be451799a29b", // Pat Vini Azrieli Haifa
    franchiseeName: 'פט ויני עזריאלי חיפה',
  },
  {
    blobUrl:
      "https://l74vafifnsibeere.public.blob.vercel-storage.com/documents/client/aed8c355-ddc8-47b9-891f-b9420d6b2dd4/__________________________________-_04_2026__SI266_1777821804467_sgpn1m.pdf",
    blobFilename:
      "__________________________________-_04_2026__SI266_1777821804467_sgpn1m.pdf",
    blobSize: 86440,
    invoiceNumber: "266010414",
    franchiseeId: "2652525b-ae70-4487-b36c-0990549d55a9", // King Kong Horev
    franchiseeName: 'קינג קונג חורב בע"מ',
  },
  {
    blobUrl:
      "https://l74vafifnsibeere.public.blob.vercel-storage.com/documents/client/aed8c355-ddc8-47b9-891f-b9420d6b2dd4/__________________________________-_04_2026__SI266_1777821817374_5fa0vg.pdf",
    blobFilename:
      "__________________________________-_04_2026__SI266_1777821817374_5fa0vg.pdf",
    blobSize: 86561,
    invoiceNumber: "266010417",
    franchiseeId: "39f939ee-678a-49bd-b7b6-6fecd40a2de9", // Kastra Tomai
    franchiseeName: 'קסטרא טומאיי בע"מ',
  },
];

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const apply = process.argv.includes("--apply");

  console.log("── Step 1: delete 3 HAAT דווח rows mis-classified as commission_invoice ──");
  for (const row of ROWS_TO_DELETE) {
    const [existing] = await database
      .select({ id: clientDocument.id, type: clientDocument.documentType })
      .from(clientDocument)
      .where(eq(clientDocument.id, row.id))
      .limit(1);
    if (!existing) {
      console.log(`  ${row.file}: row ${row.id} not found — skip`);
      continue;
    }
    console.log(
      `  ${row.file} (${row.id}, type=${existing.type}) — ${row.reason}`
    );
  }
  if (apply) {
    const deleted = await database
      .delete(clientDocument)
      .where(
        inArray(
          clientDocument.id,
          ROWS_TO_DELETE.map((r) => r.id)
        )
      )
      .returning({ id: clientDocument.id });
    console.log(`  → DELETED ${deleted.length} rows`);
  } else {
    console.log("  (dry-run; would delete 3 rows)");
  }

  console.log("\n── Step 2: insert 3 SI* central commission invoices ──");
  for (const si of SI_TO_INSERT) {
    console.log(`  SI${si.invoiceNumber} → ${si.franchiseeName}`);
    const buf = await downloadBuffer(si.blobUrl);
    const result = await parseMishlohaFile(buf, "application/pdf");
    if (!result.success || !result.data) {
      console.log(`    parser failed: ${result.errors.join(" | ")} — SKIP`);
      continue;
    }
    const data = result.data;
    console.log(
      `    parsed total=${data.totalAmount} commission=${data.commissionAmount} period=${data.periodMonth}/${data.periodYear}`
    );

    if (!apply) continue;

    const docId = randomUUID();
    try {
      await database.insert(clientDocument).values({
        id: docId,
        clientId: HAAT_CLIENT_ID,
        franchiseeId: si.franchiseeId,
        documentType: "commission_invoice",
        source: "gmail_fetch",
        originalFileName: si.blobFilename,
        fileUrl: si.blobUrl,
        fileSize: si.blobSize,
        mimeType: "application/pdf",
        periodMonth: 4,
        periodYear: 2026,
        processingStatus: "auto_approved",
        processingResult: result as unknown as Record<string, unknown>,
        totalAmount: data.totalAmount.toString(),
        commissionAmount: data.commissionAmount.toString(),
        commissionRate: data.commissionRate.toString(),
        netAmount: data.netAmount.toString(),
        invoiceNumber: si.invoiceNumber,
        allocationNumber: data.allocationNumber ?? null,
        gmailMessageId: `recovered-haat-si${si.invoiceNumber}`,
        reviewNotes:
          'שוחזר 2026-05-10: HAAT central commission invoice SI' +
          si.invoiceNumber +
          " לחודש 04/2026. הקובץ הגיע בזמן אבל ה-slot של commission_invoice היה תפוס על ידי דוח מכירות 8xxx_he שסווג בטעות (תוקן: דוח המכירות נמחק).",
        updatedAt: new Date(),
      });
      console.log(`    → INSERTED ${docId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`    → INSERT FAILED: ${msg}`);
    }
  }

  if (!apply) {
    console.log("\nDry-run. Pass --apply to commit.");
  } else {
    console.log("\nDone.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
