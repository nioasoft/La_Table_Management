/**
 * Nespresso changed column A from the legal entity alone
 * ("קסטרא טומאיי בע\"מ") to entity + restaurant
 * ("קסטרא טומאיי בע\"מ מסעדת מינה טומאי"), so 14 of 20 rows dropped from an
 * exact alias hit to a 92–99% fuzzy match and the file went from
 * auto-approved (Q1, 18/18) to flagged with 14 manual reviews.
 *
 * The customer code in column B is stable across both files, so the Q1 file —
 * which matched 18/18 exactly — is the ground truth: resolve each code by its
 * OLD name, then register the NEW name as an alias of whatever that resolved
 * to. Nothing is inferred from the fuzzy match itself.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/nespresso-longform-aliases.ts <old.xlsx> <new.xlsx> [--apply]
 */
import { readFileSync } from "fs";
import * as XLSX from "xlsx";
import {
  matchFranchiseeNamesFromFile,
  findAliasCollisions,
  updateFranchiseeAliases,
  getFranchiseeById,
} from "@/data-access/franchisees";

const APPLY = process.argv.includes("--apply");
const [OLD_FILE, NEW_FILE] = process.argv.slice(2).filter((a) => !a.startsWith("--"));

/** פט ויני (ניהול מותג) בע"מ — office consumption, deliberately not a franchisee. */
const OFFICE_ROW_CODE = 8344134;

/** Column B (customer code) → column A (name), for the data rows only. */
function readRows(path: string): Map<number, string> {
  // XLSX.readFile is absent from the ESM build — read the bytes ourselves.
  const wb = XLSX.read(readFileSync(path));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
  const byCode = new Map<number, string>();
  for (const r of rows) {
    if (typeof r[0] === "string" && typeof r[1] === "number" && typeof r[2] === "number") {
      byCode.set(r[1], r[0].trim());
    }
  }
  return byCode;
}

async function resolve(names: string[]) {
  const rows = await matchFranchiseeNamesFromFile(names.map((franchisee) => ({ franchisee })));
  return new Map(rows.map((r) => [r.franchisee, r.matchResult]));
}

async function main() {
  if (!OLD_FILE || !NEW_FILE) throw new Error("usage: <old.xlsx> <new.xlsx> [--apply]");
  const oldNames = readRows(OLD_FILE);
  const newNames = readRows(NEW_FILE);

  const oldMatches = await resolve([...new Set(oldNames.values())]);
  const newMatches = await resolve([...new Set(newNames.values())]);

  const plan: Array<{ code: number; alias: string; fId: string; fName: string; via: string }> = [];
  const skipped: string[] = [];

  for (const [code, newName] of newNames) {
    if (code === OFFICE_ROW_CODE) {
      skipped.push(`${code}  ${newName}  → רשימת התעלמות, לא כינוי`);
      continue;
    }
    const oldName = oldNames.get(code);
    if (oldName === newName) {
      skipped.push(`${code}  ${newName}  → השם לא השתנה`);
      continue;
    }
    if (newMatches.get(newName)?.confidence === 1) {
      skipped.push(`${code}  ${newName}  → כבר מותאם מדויק`);
      continue;
    }

    const truth = oldName ? oldMatches.get(oldName) : undefined;
    if (!truth?.matchedFranchisee || truth.confidence < 1) {
      skipped.push(`${code}  ${newName}  → אין אמת מידה מהקובץ הישן (old="${oldName ?? "-"}"), דילוג`);
      continue;
    }

    const owner = await getFranchiseeById(truth.matchedFranchisee.id);
    if ((owner?.aliases ?? []).some((a) => a.trim().toLowerCase() === newName.toLowerCase())) {
      skipped.push(`${code}  ${newName}  → הכינוי כבר קיים`);
      continue;
    }

    plan.push({
      code,
      alias: newName,
      fId: truth.matchedFranchisee.id,
      fName: truth.matchedFranchisee.name,
      via: oldName!,
    });
  }

  console.log(`\n${plan.length} כינויים להוספה:\n`);
  for (const p of plan) console.log(`  ${p.code}  "${p.alias}"\n         → ${p.fName}   (דרך "${p.via}")`);
  console.log(`\n${skipped.length} דילוגים:`);
  for (const s of skipped) console.log("  " + s);

  // Every alias must be free across all franchisees before any of them is written —
  // a shared alias routes that name to the wrong franchisee.
  const collisions = (await findAliasCollisions(plan.map((p) => p.alias))).filter(
    (c) => !plan.some((p) => p.alias === c.alias && p.fId === c.ownerId)
  );
  if (collisions.length > 0) {
    console.error("\nהתנגשויות — לא נכתב כלום:");
    for (const c of collisions) console.error(`  "${c.alias}" כבר אצל ${c.ownerName}`);
    process.exit(1);
  }
  console.log("\nללא התנגשויות.");

  if (!APPLY) {
    console.log("\n(הרצה יבשה — הוסיפי --apply לכתיבה)");
    process.exit(0);
  }

  const byFranchisee = new Map<string, string[]>();
  for (const p of plan) byFranchisee.set(p.fId, [...(byFranchisee.get(p.fId) ?? []), p.alias]);
  for (const [fId, aliases] of byFranchisee) {
    const current = await getFranchiseeById(fId);
    if (!current) throw new Error(`franchisee ${fId} missing`);
    await updateFranchiseeAliases(fId, [...(current.aliases ?? []), ...aliases]);
    console.log(`נכתב: ${current.name} += ${aliases.join(" | ")}`);
  }
  console.log(`\nהושלם: ${plan.length} כינויים.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
