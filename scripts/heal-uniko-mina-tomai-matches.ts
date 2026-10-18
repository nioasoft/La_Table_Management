/**
 * One-off heal for יוניקו (2026-10-18). Reut corrected two rows on the upload
 * screen, but edits made after the anomaly dialog's auto-save were state-only,
 * so the saved files and commissions kept the wrong franchisees. Two aliases
 * kept re-creating the mistake on every upload:
 *   - "יהוד (מינה טומאיי)" sat on both טמפר הסעדה and מינה טומאיי יהוד
 *     (misrouted since 2026-05-07, incl. the Q2 file approved 2026-10-15)
 *   - "M_-82 (מינה טומאיי)" sat on קסטרא; Reut says it is אודון
 *
 * Usage:
 *   npx tsx scripts/heal-uniko-mina-tomai-matches.ts           # dry-run
 *   npx tsx scripts/heal-uniko-mina-tomai-matches.ts --apply   # write
 */
import "dotenv/config";
import {
  getFranchiseeById,
  removeFranchiseeAlias,
  addFranchiseeAlias,
} from "../src/data-access/franchisees";
import {
  getSupplierFileById,
  updateSupplierFileMatch,
  syncCommissionsFromUpload,
} from "../src/data-access/supplier-file-uploads";
import { markSupplierSessionsStale } from "../src/data-access/reconciliation-v2";

const APPLY = process.argv.includes("--apply");

const TEMPER = "b5de7b45-04a0-447f-8345-4001b07425d0"; // טמפר הסעדה (פאט ויני יהוד)
const MINA_YEHUD = "415c3ddb-4142-4931-ad59-2dd34e0bb30f"; // מינה טומאיי יהוד
const KASTRA = "39f939ee-678a-49bd-b7b6-6fecd40a2de9"; // קסטרא טומאיי
const ODON = "2d40a15f-93e0-40c2-b046-07fa52267b7b"; // אודון ניהול ואחזקות

const YEHUD = "יהוד (מינה טומאיי)";
const M82 = "M_-82 (מינה טומאיי)";

const Q2_FILE = "45f358df-ec6e-4e31-96a1-a5d7ee7c9726";
const Q3_FILE = "8c18cabe-064e-4cb8-b75a-fa2f23e24158";

const ROW_FIXES = [
  { fileId: Q3_FILE, originalName: YEHUD, from: TEMPER, to: MINA_YEHUD },
  { fileId: Q3_FILE, originalName: M82, from: KASTRA, to: ODON },
  { fileId: Q2_FILE, originalName: YEHUD, from: TEMPER, to: MINA_YEHUD },
];

async function fixAliases() {
  const temper = await getFranchiseeById(TEMPER);
  const kastra = await getFranchiseeById(KASTRA);
  const odon = await getFranchiseeById(ODON);
  if (!temper || !kastra || !odon) throw new Error("franchisee missing");

  const plan = [
    { label: `remove "${YEHUD}" from ${temper.name}`, needed: (temper.aliases ?? []).includes(YEHUD),
      run: () => removeFranchiseeAlias(TEMPER, YEHUD) },
    { label: `remove "${M82}" from ${kastra.name}`, needed: (kastra.aliases ?? []).includes(M82),
      run: () => removeFranchiseeAlias(KASTRA, M82) },
    { label: `add "${M82}" to ${odon.name}`, needed: !(odon.aliases ?? []).includes(M82),
      run: () => addFranchiseeAlias(ODON, M82) },
  ];
  for (const step of plan) {
    console.log(`${step.needed ? (APPLY ? "APPLY" : "WOULD") : "SKIP (done)"}: ${step.label}`);
    if (step.needed && APPLY) await step.run();
  }
}

async function fixRows() {
  const touched = new Set<string>();
  for (const fix of ROW_FIXES) {
    const file = await getSupplierFileById(fix.fileId);
    const row = file?.processingResult?.franchiseeMatches.find((m) => m.originalName === fix.originalName);
    if (!file || !row) throw new Error(`row "${fix.originalName}" not found in ${fix.fileId}`);
    const target = await getFranchiseeById(fix.to);
    if (!target) throw new Error(`franchisee ${fix.to} missing`);

    const label = `${file.periodStartDate} ${fix.originalName} (₪${row.grossAmount}): ${row.matchedFranchiseeName} → ${target.name}`;
    if (row.matchedFranchiseeId === fix.to) {
      console.log(`SKIP (done): ${label}`);
      continue;
    }
    if (row.matchedFranchiseeId !== fix.from) {
      throw new Error(`unexpected current match, refusing: ${label}`);
    }
    console.log(`${APPLY ? "APPLY" : "WOULD"}: ${label}`);
    if (APPLY) {
      await updateSupplierFileMatch(fix.fileId, fix.originalName, target.id, target.name);
      touched.add(fix.fileId);
    }
  }

  for (const fileId of touched) {
    const file = await getSupplierFileById(fileId);
    const result = await syncCommissionsFromUpload(fileId, file!.createdBy!);
    console.log(`SYNC ${fileId}:`, result);
  }

  // Sessions store amounts at build time — flag them so the UI offers "בנה מחדש",
  // same as saving a new file does.
  if (!APPLY) return;
  for (const fileId of [Q2_FILE, Q3_FILE]) {
    const file = await getSupplierFileById(fileId);
    const flagged = await markSupplierSessionsStale(file!.supplierId, file!.periodStartDate!, file!.periodEndDate!);
    console.log(`STALE ${file!.periodStartDate}: ${flagged} session(s) flagged`);
  }
}

async function main() {
  console.log(APPLY ? "=== APPLY ===" : "=== DRY RUN (pass --apply to write) ===");
  await fixAliases();
  await fixRows();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
