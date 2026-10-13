/**
 * One-off recovery: Mishloha 09/2026 client_report for קינג קונג ביג / חדרה / מוצקין.
 *
 * Incident (Reut 2026-10-13): all nine King Kong ezcount "[העתק]" copies of
 * 30/09–02/10 failed with "ללא קבצים מצורפים ולא נמצאו לינקים להורדה" — the
 * link WAS there, but ezcount withheld the PDF until the invoices got their
 * מספר הקצאה on 11–12/10 (the branches' tax-authority access had lapsed).
 * Nothing retried, so on 12/10 the Mishloha slots were filled by hand — with
 * חורב's invoice 10060 (₪18,506.46) uploaded to ביג, חדרה and מוצקין as well.
 *
 * The real invoices, re-downloaded from the same email links:
 *   ביג    10061  ₪19,941.79  (Tabit ₪20,238.30)
 *   חדרה   10022  ₪12,091.47  (Tabit ₪12,241.00)
 *   מוצקין 10007  ₪11,672.70  (Tabit ₪11,884.30)
 *
 * For each: download through the pipeline's own `extractAndDownloadLinks`,
 * verify the parser reads the expected invoice number and franchisee, then
 * replace the wrong slot via processClientDocument (allowReplace) under the
 * dedup key the webhook would have used (`<emailId>#dl0`), and mark the
 * original gmail_sync_log row completed.
 *
 * Usage:
 *   npx tsx scripts/recover-mishloha-kingkong-sept-2026.ts          # dry-run
 *   npx tsx scripts/recover-mishloha-kingkong-sept-2026.ts --apply  # commit
 */
import "dotenv/config";
import { database } from "../src/db";
import { client, franchisee, gmailSyncLog, type Franchisee } from "../src/db/schema";
import { eq, sql } from "drizzle-orm";
import { processClientDocument } from "../src/lib/client-document-processor";
import { getClientParser } from "../src/lib/client-parsers";
import { extractAndDownloadLinks } from "../src/lib/email/download-links";
import { matchFranchiseeName } from "../src/lib/franchisee-matcher";

const PERIOD = { month: 9, year: 2026 };
const TARGETS = [
  { emailId: "b695e647-b387-4840-8a1f-617d841c002f", franchisee: 'קינג קונג ביג בע"מ', invoice: "10061" },
  { emailId: "5bf2f7c1-fc30-4288-9684-028565944e46", franchisee: 'קינג קונג חדרה בע"מ', invoice: "10022" },
  { emailId: "4b9d4e90-9529-402b-9ff2-aa62677596b1", franchisee: 'קינג קונג מוצקין בע"מ', invoice: "10007" },
];

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const [mishloha] = await database.select().from(client).where(eq(client.code, "MISHLOCHA"));
  if (!mishloha) throw new Error("MISHLOCHA client not found");
  const parserCode = mishloha.parserCode ?? mishloha.code ?? "";
  const parser = getClientParser(parserCode);
  if (!parser) throw new Error(`no client parser for ${parserCode}`);
  const active = (await database
    .select()
    .from(franchisee)
    .where(eq(franchisee.isActive, true))) as Franchisee[];

  for (const t of TARGETS) {
    const target = active.find((f) => f.name === t.franchisee);
    if (!target) throw new Error(`franchisee not found: ${t.franchisee}`);

    const [log] = await database.select().from(gmailSyncLog).where(eq(gmailSyncLog.emailId, t.emailId));
    if (!log?.bodyExcerpt) throw new Error(`no sync log / body for ${t.emailId}`);

    // The body repeats the link (Outlook VML button + <a>), so expect ≥1 copies of one file.
    const files = await extractAndDownloadLinks(log.bodyExcerpt, "MISHLOCHA");
    if (files.length === 0) throw new Error(`${t.emailId}: ezcount link did not download`);
    const file = files[0];

    // Verify before writing: right invoice, and its issuer is the target branch.
    const parsed = await parser(file.buffer, "application/pdf");
    const name = parsed.data?.franchiseeName ?? "";
    const matched = matchFranchiseeName(name, active, { minConfidence: 0.85 }).matchedFranchisee;
    if (parsed.data?.invoiceNumber !== t.invoice || matched?.id !== target.id) {
      throw new Error(
        `${t.franchisee}: parsed invoice=${parsed.data?.invoiceNumber} name="${name}" → ${matched?.name ?? "none"}; expected ${t.invoice}`,
      );
    }
    console.log(
      `${apply ? "APPLY" : "DRY"} ${t.franchisee}: invoice ${t.invoice} total=${parsed.data?.totalAmount} alloc=${parsed.data?.allocationNumber}`,
    );
    if (!apply) continue;

    const result = await processClientDocument({
      buffer: file.buffer,
      fileName: file.fileName,
      mimeType: "application/pdf",
      clientId: mishloha.id,
      parserCode,
      franchiseeId: target.id,
      periodMonth: PERIOD.month,
      periodYear: PERIOD.year,
      documentType: "client_report",
      source: "gmail_fetch",
      gmailMessageId: `${t.emailId}#dl0`,
      allowReplace: true,
    });
    if (!result.success || !result.document) {
      throw new Error(`${t.franchisee}: processClientDocument failed: ${result.error ?? "duplicate?"}`);
    }
    console.log(`  → client_document ${result.document.id} total=${result.document.totalAmount}`);

    await database
      .update(gmailSyncLog)
      .set({
        status: "completed",
        documentsCreated: 1,
        errorCount: 0,
        errorDetails: sql`coalesce(${gmailSyncLog.errorDetails}, '[]'::jsonb) || ${JSON.stringify([
          "נקלט ידנית 2026-10-13 אחרי שעזקאונט שחררה את הקובץ (recover-mishloha-kingkong-sept-2026)",
        ])}::jsonb`,
      })
      .where(eq(gmailSyncLog.id, log.id));
  }

  console.log(`\ndone. dry-run=${!apply}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
