/**
 * Enter ימה וקדמה's corrected Q2-2026 file into production by hand, through
 * the same path an upload takes.
 *
 * The supplier reissued Q2 with two corrections — קסטרא טומאיי (a −2,944 credit
 * booked to the brand-management entity, now +2,975 on the restaurant itself)
 * and קינג קונג ביג קרית אתא (455 → 3,229). Every other franchisee is unchanged.
 *
 * Nothing here is hand-typed: the file is parsed, matched, stored and synced by
 * the same functions POST /api/supplier-files calls, so the result cannot drift
 * from what the screen would have produced. The one manual act is pinning
 * "קסטרא טומאיי" — a spelling this file introduces, which the matcher reaches at
 * 92% — to the franchisee the same customer code (429105) resolved to in the
 * file being replaced.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/import-yama-q2-corrected.ts <file.xls> [--apply]
 */
import { readFileSync } from "fs";
import { createRequire } from "module";
import { processSupplierFile, getCurrentVatRate } from "@/lib/file-processor";
import { getSupplierById } from "@/data-access/suppliers";
import {
  matchFranchiseeNamesFromFileWithAnomalies,
  getFranchiseeById,
  findAliasCollisions,
  updateFranchiseeAliases,
} from "@/data-access/franchisees";
import {
  getSupplierFileByPeriod,
  createSupplierFileUpload,
  reviewSupplierFile,
  syncCommissionsFromUpload,
} from "@/data-access/supplier-file-uploads";
import { markSupplierSessionsStale } from "@/data-access/reconciliation-v2";
import { uploadDocument, generateEntityFileName } from "@/lib/storage";
import type { SupplierFileProcessingResult } from "@/db/schema";

// The CJS build carries the CP1255 codepage table the ESM one lacks — without
// it a real .xls decodes as mojibake.
const XLSX = createRequire(import.meta.url)("xlsx");

const SUPPLIER_ID = "931d9637-923b-4e73-af06-116bd7647623"; // ימה וקדמה
const PERIOD_START = "2026-04-01";
const PERIOD_END = "2026-06-30";
const UPLOADER = "YeUolzuyyTtH7d7bXEHeGIR3GewDlSE8"; // רעות לוי — the file is hers
const STORED_NAME = "ימה וקדמה Q2-2026 מתוקן.xlsx";

/** Rows this file spells differently from the franchisee they belong to. */
const MANUAL_MATCHES: Record<string, string> = {
  "קסטרא טומאיי": "קסטרא טומאיי בע\"מ",
};

const APPLY = process.argv.includes("--apply");
const FILE = process.argv.slice(2).find((a) => !a.startsWith("--"));

async function main() {
  if (!FILE) throw new Error("usage: <file.xls> [--apply]");
  const supplier = await getSupplierById(SUPPLIER_ID);
  if (!supplier) throw new Error("supplier not found");

  // Mirror the browser: .xls is re-encoded to .xlsx before upload (the WAF
  // blocks .xls), so the bytes we store are the bytes an upload would store.
  const raw = readFileSync(FILE);
  const workbook = XLSX.read(raw, { type: "buffer" });
  const converted = Buffer.from(
    XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer
  );

  const result = await processSupplierFile(
    converted,
    (supplier as never as { fileMapping: never }).fileMapping,
    supplier.vatIncluded ?? false,
    await getCurrentVatRate(),
    supplier.code ?? undefined,
    supplier.vatExempt ?? false,
    undefined,
    STORED_NAME
  );
  if (!result.success || result.data.length === 0) {
    throw new Error(`parse failed: ${result.errors.map((e) => e.code).join(", ")}`);
  }

  const outcome = await matchFranchiseeNamesFromFileWithAnomalies(result.data);

  const franchiseeMatches: SupplierFileProcessingResult["franchiseeMatches"] = [];
  const aliasesToAdd: Array<{ franchiseeId: string; alias: string; owner: string }> = [];

  for (const row of outcome.rows) {
    const pinnedName = MANUAL_MATCHES[row.franchisee];
    const suggested = row.matchResult.matchedFranchisee;

    let matchedId: string | null = suggested?.id ?? null;
    let matchedName: string | null = suggested?.name ?? null;
    let matchType: "exact" | "fuzzy" | "manual" | "none" = !suggested
      ? "none"
      : row.matchResult.confidence === 1
        ? "exact"
        : "fuzzy";
    let confidence = (row.matchResult.confidence ?? 0) * 100;

    if (pinnedName) {
      if (suggested?.name !== pinnedName) {
        throw new Error(
          `"${row.franchisee}" was expected to resolve to "${pinnedName}" but the matcher suggested "${suggested?.name ?? "nothing"}" — refusing to pin blind`
        );
      }
      matchedId = suggested.id;
      matchedName = suggested.name;
      matchType = "manual";
      confidence = 100;
      aliasesToAdd.push({ franchiseeId: suggested.id, alias: row.franchisee, owner: suggested.name });
    }

    if (!matchedId) throw new Error(`unmatched row: "${row.franchisee}" — resolve it before importing`);

    franchiseeMatches.push({
      originalName: row.franchisee,
      rowNumber: row.rowNumber ?? 0,
      grossAmount: row.grossAmount,
      netAmount: row.netAmount,
      matchedFranchiseeId: matchedId,
      matchedFranchiseeName: matchedName,
      confidence,
      matchType,
      requiresReview: false,
      preCalculatedCommission: row.preCalculatedCommission,
    });
  }

  const matchStats = {
    total: franchiseeMatches.length,
    exactMatches: franchiseeMatches.filter((m) => m.matchType === "exact" || m.matchType === "manual").length,
    fuzzyMatches: franchiseeMatches.filter((m) => m.matchType === "fuzzy").length,
    unmatched: franchiseeMatches.filter((m) => m.matchType === "none").length,
    blacklisted: 0,
  };

  const existing = await getSupplierFileByPeriod(
    SUPPLIER_ID,
    new Date(PERIOD_START),
    new Date(PERIOD_END)
  );

  console.log(`\nקובץ: ${STORED_NAME}  (${converted.length} בייט)`);
  console.log(`תקופה: ${PERIOD_START} — ${PERIOD_END}`);
  console.log(`שורות: ${franchiseeMatches.length} · נטו ₪${result.summary.totalNetAmount} · ברוטו ₪${result.summary.totalGrossAmount}`);
  console.log(`התאמות: ${matchStats.exactMatches} מדויק/ידני, ${matchStats.fuzzyMatches} מטושטש, ${matchStats.unmatched} ללא\n`);
  for (const m of franchiseeMatches) {
    console.log(`  ${m.originalName.padEnd(40)} ₪${String(Math.round(m.netAmount)).padStart(7)}  →  ${m.matchedFranchiseeName}  [${m.matchType}]`);
  }
  console.log(`\nמחליף: ${existing ? `${existing.originalFileName} (${existing.id}, ${existing.processingStatus})` : "אין קובץ קיים"}`);
  if (aliasesToAdd.length) {
    for (const a of aliasesToAdd) console.log(`כינוי להוספה: "${a.alias}" → ${a.owner}`);
    const collisions = (await findAliasCollisions(aliasesToAdd.map((a) => a.alias))).filter(
      (c) => !aliasesToAdd.some((a) => a.alias === c.alias && a.franchiseeId === c.ownerId)
    );
    if (collisions.length) {
      throw new Error(`alias collision: ${collisions.map((c) => `"${c.alias}" @ ${c.ownerName}`).join(", ")}`);
    }
  }

  if (!APPLY) {
    console.log("\n(הרצה יבשה — הוסף --apply לכתיבה)");
    process.exit(0);
  }

  for (const a of aliasesToAdd) {
    const owner = await getFranchiseeById(a.franchiseeId);
    if (!owner) throw new Error("franchisee vanished");
    const current = owner.aliases ?? [];
    if (!current.some((x) => x.trim().toLowerCase() === a.alias.toLowerCase())) {
      await updateFranchiseeAliases(a.franchiseeId, [...current, a.alias]);
      console.log(`נכתב כינוי: ${owner.name} += ${a.alias}`);
    }
  }

  const upload = await uploadDocument(
    converted,
    STORED_NAME,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "supplier",
    SUPPLIER_ID,
    { customFileName: generateEntityFileName(supplier.name, PERIOD_START, STORED_NAME) }
  );
  console.log(`הועלה לאחסון: ${upload.url}`);

  if (existing) {
    await reviewSupplierFile(existing.id, "reject", UPLOADER, "הוחלף בקובץ Q2-2026 המתוקן (קסטרא טומאיי + קינג קונג ביג)");
    console.log(`הקובץ הקודם נדחה: ${existing.id}`);
  }

  const processingResult: SupplierFileProcessingResult = {
    totalRows: result.summary.totalRows,
    processedRows: result.summary.processedRows,
    skippedRows: result.summary.skippedRows,
    totalGrossAmount: result.summary.totalGrossAmount,
    totalNetAmount: result.summary.totalNetAmount,
    vatAdjusted: result.summary.vatAdjusted,
    matchStats,
    franchiseeMatches,
    processedAt: new Date().toISOString(),
    anomalies: result.anomalies,
  };

  const newFile = await createSupplierFileUpload({
    supplierId: SUPPLIER_ID,
    originalFileName: STORED_NAME,
    fileUrl: upload.url,
    fileSize: converted.length,
    processingStatus: "auto_approved",
    processingResult,
    periodStartDate: PERIOD_START,
    periodEndDate: PERIOD_END,
    createdBy: UPLOADER,
  } as never);
  console.log(`נוצר קובץ חדש: ${newFile.id}`);

  const sync = await syncCommissionsFromUpload(newFile.id, UPLOADER);
  console.log(`עמלות: נוצרו ${sync.created}, נכשלו ${sync.failed}${sync.skipped ? ` (דולג: ${sync.reason})` : ""}`);

  await reviewSupplierFile(
    newFile.id,
    "approve",
    UPLOADER,
    "הוזן ידנית מהקובץ המתוקן של ימה וקדמה ל-Q2-2026"
  );
  const stale = await markSupplierSessionsStale(SUPPLIER_ID, PERIOD_START, PERIOD_END);
  console.log(`סשני התאמה שסומנו לרענון: ${stale}`);
  console.log("\nהושלם.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
