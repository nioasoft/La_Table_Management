/**
 * One-off: un-link BKMV breakdown rows that were linked to a supplier by a
 * FUZZY match (< 100%, not manual).
 *
 * Reut, 2026-10-18: "אם הספק לא מותאם 100% במבנה אחיד שלא יופיע לי בדוח
 * התאמות" — manual = 100% = fine. Fresh uploads already linked exact matches
 * only, but every rebuild from stored matches (a manual match in the BKMV
 * review screen, the legacy reprocess route) copied matchedSupplierId as-is,
 * fuzzy ones included — "קינג קו" → וונג שו at 65% (₪988K), "פלאקסי ישראל"
 * → מקאטי at 61%. Code now goes through trustedSupplierId(); this cleans the
 * stored data:
 *
 *   0. CONFIRMED fuzzy matches (correct ones, reviewed by Asaf) become manual
 *      matches + supplier bkmvAliases, and are linked where they were null —
 *      so they keep counting instead of turning into gaps.
 *   1. uploaded_file.bkmv_processing_result.monthlyBreakdown — per file, from
 *      that file's own supplierMatches.
 *   2. franchisee_bkmv_year.monthly_breakdown (+ supplier_matches re-derived) —
 *      a (name, supplier) pair is unlinked only when it is fuzzy in some file of
 *      that franchisee and trusted in none.
 *   3. Active reconciliation sessions touched by a change are flagged stale →
 *      "בנה מחדש". Not rebuilt here: a rebuild starts a fresh run and drops
 *      manual approvals.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/heal-bkmv-fuzzy-supplier-links.ts          # dry run
 *   dotenv -e .env -- npx tsx src/scripts/heal-bkmv-fuzzy-supplier-links.ts --apply
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import {
  franchisee,
  franchiseeBkmvYear,
  reconciliationComparison,
  reconciliationSession,
  supplier,
  uploadedFile,
  type BkmvProcessingResult,
} from "@/db/schema";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  aggregateSupplierMatchesFromBreakdown,
  trustedSupplierId,
  type MonthlyBreakdown,
} from "@/lib/bkmvdata-parser";

const APPLY = process.argv.includes("--apply");

/** BKMV name → supplier name. Fuzzy matches confirmed correct (2026-10-18). */
const CONFIRMED: Record<string, string> = {
  "ארגל פוד סרוויס (שרות ארגל )": "ארגל",
  "ארגל פוד סרוויס (שרותי ארגל)": "ארגל",
  'וונג שו תעשיות בע"מ': "וונג שו",
  "תוית הצפון": "תויות הצפון",
  "פרש פסטה פרימיום פקטורי בעמ": "פרש פסטה",
  'פרש פסטה פרימיום פקטורי בע"מ': "פרש פסטה",
  'רסטרטו ייבוא ושיווק בע"מ': "רסטרטו",
  'סופר נוב בע"מ': "סופר נובה",
  'יעקב סוכנויות יבוא בע"מ': "יעקב סוכנויות",
  'הולי קראק פאי בע"מ': "הולי קראק פאי",
};

type Change = {
  kind: "link" | "unlink";
  franchiseeId: string;
  supplierId: string;
  month: string;
  amount: number;
};

/** Re-point every entry to `next(name, current)`; returns what moved. */
function remap(
  breakdown: MonthlyBreakdown,
  franchiseeId: string,
  next: (name: string, current: string | null) => string | null
): { fixed: MonthlyBreakdown; changes: Change[] } {
  const changes: Change[] = [];
  const fixed: MonthlyBreakdown = {};
  for (const [month, entries] of Object.entries(breakdown)) {
    fixed[month] = entries.map((e) => {
      const to = next(e.supplierName.trim(), e.supplierId);
      if (to === e.supplierId) return e;
      changes.push({
        kind: to ? "link" : "unlink",
        franchiseeId,
        supplierId: (to ?? e.supplierId)!,
        month,
        amount: e.amount,
      });
      return { ...e, supplierId: to };
    });
  }
  return { fixed, changes };
}

async function main() {
  const suppliers = await database
    .select({ id: supplier.id, name: supplier.name, bkmvAliases: supplier.bkmvAliases })
    .from(supplier);
  const supplierByName = new Map(suppliers.map((s) => [s.name, s]));
  const confirmedId = new Map<string, string>();
  for (const [bkmvName, supplierName] of Object.entries(CONFIRMED)) {
    const s = supplierByName.get(supplierName);
    if (!s) throw new Error(`supplier not found: ${supplierName}`);
    confirmedId.set(bkmvName, s.id);
  }

  // ── 0. aliases ────────────────────────────────────────────────────────────
  const aliasAdds = new Map<string, string[]>();
  for (const [bkmvName, sid] of confirmedId) {
    const s = suppliers.find((x) => x.id === sid)!;
    const aliases = (s.bkmvAliases as string[] | null) ?? [];
    if (aliases.includes(bkmvName)) continue;
    aliasAdds.set(sid, [...(aliasAdds.get(sid) ?? aliases), bkmvName]);
  }
  for (const [sid, aliases] of aliasAdds) {
    const s = suppliers.find((x) => x.id === sid)!;
    console.log(`alias + ${s.name}: ${aliases.filter((a) => !((s.bkmvAliases as string[] | null) ?? []).includes(a)).join(" | ")}`);
    if (APPLY) {
      await database.update(supplier).set({ bkmvAliases: aliases, updatedAt: new Date() }).where(eq(supplier.id, sid));
    }
  }

  const files = await database
    .select({
      id: uploadedFile.id,
      franchiseeId: uploadedFile.franchiseeId,
      result: uploadedFile.bkmvProcessingResult,
    })
    .from(uploadedFile)
    .where(isNotNull(uploadedFile.bkmvProcessingResult));

  // Per franchisee: "name|supplierId" pairs seen fuzzy anywhere / trusted anywhere,
  // and the confirmed name → supplier links to fill in.
  const fuzzyPairs = new Map<string, Set<string>>();
  const trustedPairs = new Map<string, Set<string>>();
  const confirmedByFranchisee = new Map<string, Map<string, string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) =>
    m.set(k, (m.get(k) ?? new Set()).add(v));

  // ── 0+1. files: confirm, then link/unlink ─────────────────────────────────
  let confirmedMatches = 0;
  const fileChanges: Change[] = [];
  let filesTouched = 0;
  for (const f of files) {
    const result = f.result as BkmvProcessingResult;
    let confirmedHere = 0;
    const supplierMatches = (result.supplierMatches ?? []).map((m) => {
      const sid = confirmedId.get(m.bkmvName.trim());
      if (!sid || m.matchedSupplierId !== sid || trustedSupplierId(m)) return m;
      confirmedHere++;
      return { ...m, confidence: 1, matchType: "manual", requiresReview: false };
    });
    confirmedMatches += confirmedHere;

    const fuzzyByName = new Map<string, string>();
    const linkByName = new Map<string, string>();
    for (const m of supplierMatches) {
      if (!m.matchedSupplierId) continue;
      const name = m.bkmvName.trim();
      const pair = `${name}|${m.matchedSupplierId}`;
      if (trustedSupplierId(m)) {
        if (f.franchiseeId) add(trustedPairs, f.franchiseeId, pair);
        if (confirmedId.get(name) === m.matchedSupplierId) {
          linkByName.set(name, m.matchedSupplierId);
          if (f.franchiseeId) {
            const c = confirmedByFranchisee.get(f.franchiseeId) ?? new Map<string, string>();
            confirmedByFranchisee.set(f.franchiseeId, c.set(name, m.matchedSupplierId));
          }
        }
      } else {
        fuzzyByName.set(name, m.matchedSupplierId);
        if (f.franchiseeId) add(fuzzyPairs, f.franchiseeId, pair);
      }
    }

    const { fixed, changes } = result.monthlyBreakdown
      ? remap(result.monthlyBreakdown, f.franchiseeId ?? "", (name, cur) => {
          if (cur === null && linkByName.has(name)) return linkByName.get(name)!;
          if (cur !== null && fuzzyByName.get(name) === cur) return null;
          return cur;
        })
      : { fixed: result.monthlyBreakdown, changes: [] };
    if (confirmedHere === 0 && changes.length === 0) continue;

    fileChanges.push(...changes);
    filesTouched++;
    if (APPLY) {
      const stats = result.matchStats;
      await database
        .update(uploadedFile)
        .set({
          bkmvProcessingResult: {
            ...result,
            supplierMatches,
            monthlyBreakdown: fixed,
            ...(stats && {
              matchStats: {
                ...stats,
                exactMatches: stats.exactMatches + confirmedHere,
                fuzzyMatches: Math.max(0, stats.fuzzyMatches - confirmedHere),
              },
            }),
          },
        })
        .where(eq(uploadedFile.id, f.id));
    }
  }
  const count = (cs: Change[], k: Change["kind"]) => cs.filter((c) => c.kind === k).length;
  console.log(
    `\nfiles: ${filesTouched} touched — ${confirmedMatches} matches confirmed as manual, ` +
      `${count(fileChanges, "link")} entries linked, ${count(fileChanges, "unlink")} unlinked`
  );

  // ── 2. year archive ───────────────────────────────────────────────────────
  const years = await database
    .select({
      id: franchiseeBkmvYear.id,
      franchiseeId: franchiseeBkmvYear.franchiseeId,
      breakdown: franchiseeBkmvYear.monthlyBreakdown,
    })
    .from(franchiseeBkmvYear);

  const yearChanges: Change[] = [];
  for (const y of years) {
    if (!y.breakdown) continue;
    const fuzzy = fuzzyPairs.get(y.franchiseeId) ?? new Set<string>();
    const trusted = trustedPairs.get(y.franchiseeId) ?? new Set<string>();
    const confirmed = confirmedByFranchisee.get(y.franchiseeId);
    const { fixed, changes } = remap(y.breakdown as MonthlyBreakdown, y.franchiseeId, (name, cur) => {
      if (cur === null && confirmed?.has(name)) return confirmed.get(name)!;
      if (cur !== null && fuzzy.has(`${name}|${cur}`) && !trusted.has(`${name}|${cur}`)) return null;
      return cur;
    });
    if (changes.length === 0) continue;
    yearChanges.push(...changes);
    if (APPLY) {
      await database
        .update(franchiseeBkmvYear)
        .set({
          monthlyBreakdown: sql`${JSON.stringify(fixed)}::jsonb`,
          supplierMatches: sql`${JSON.stringify(aggregateSupplierMatchesFromBreakdown(fixed))}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(franchiseeBkmvYear.id, y.id));
    }
  }

  // ── 3. report + stale sessions ────────────────────────────────────────────
  type Pair = { kind: Change["kind"]; franchiseeId: string; supplierId: string; from: string; to: string; amount: number };
  const byPair = new Map<string, Pair>();
  for (const c of yearChanges) {
    const k = `${c.kind}|${c.franchiseeId}|${c.supplierId}`;
    const cur = byPair.get(k);
    if (!cur) byPair.set(k, { ...c, from: c.month, to: c.month });
    else {
      cur.amount += c.amount;
      if (c.month < cur.from) cur.from = c.month;
      if (c.month > cur.to) cur.to = c.month;
    }
  }
  const pairs = [...byPair.values()].sort((a, b) => a.kind.localeCompare(b.kind) || b.amount - a.amount);
  const fNames = new Map(
    (await database.select({ id: franchisee.id, name: franchisee.name }).from(franchisee)).map((r) => [r.id, r.name])
  );
  const sNames = new Map(suppliers.map((s) => [s.id, s.name]));

  console.log(
    `year archive: ${count(yearChanges, "link")} entries linked, ${count(yearChanges, "unlink")} unlinked ` +
      `across ${pairs.length} (branch, supplier) pairs\n`
  );

  const staleIds = new Set<string>();
  for (const p of pairs) {
    // An unlinked amount sits on an existing row; a newly linked one may need
    // a row the session never had — so links match any session of the supplier.
    const sessions = await database
      .selectDistinct({
        id: reconciliationSession.id,
        start: reconciliationSession.periodStartDate,
        end: reconciliationSession.periodEndDate,
        status: reconciliationSession.status,
      })
      .from(reconciliationSession)
      .leftJoin(
        reconciliationComparison,
        and(
          eq(reconciliationComparison.sessionId, reconciliationSession.id),
          eq(reconciliationComparison.franchiseeId, p.franchiseeId)
        )
      )
      .where(
        and(
          eq(reconciliationSession.supplierId, p.supplierId),
          isNull(reconciliationSession.archivedAt),
          sql`to_char(${reconciliationSession.periodStartDate}, 'YYYY-MM') <= ${p.to}`,
          sql`to_char(${reconciliationSession.periodEndDate}, 'YYYY-MM') >= ${p.from}`,
          p.kind === "unlink" ? isNotNull(reconciliationComparison.id) : undefined
        )
      );
    sessions.forEach((s) => staleIds.add(s.id));
    console.log(
      `${p.kind === "link" ? "+" : "-"} ${sNames.get(p.supplierId)} ← ${fNames.get(p.franchiseeId)}  ${p.from}..${p.to}  ₪${Math.round(p.amount).toLocaleString()}` +
        (sessions.length ? `  sessions: ${sessions.map((s) => `${s.start}..${s.end} (${s.status})`).join(", ")}` : "")
    );
  }

  if (APPLY && staleIds.size > 0) {
    await database
      .update(reconciliationSession)
      .set({ staleAt: new Date(), updatedAt: new Date() })
      .where(inArray(reconciliationSession.id, [...staleIds]));
  }
  console.log(`\n${staleIds.size} active sessions ${APPLY ? "flagged stale" : "would be flagged stale"}`);
  if (!APPLY) console.log("Dry run — re-run with --apply to write.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
