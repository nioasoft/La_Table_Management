/**
 * Idempotent seed of the Hashavshevet (H-Connect) companies and their
 * brand / franchisee assignments (spec §4).
 *
 * - Upserts the 14 companies by file_name. Only comp_id and name_he are ever
 *   overwritten: live_from and requires_approval are operator settings and a
 *   re-run must not reset them. DEMO is deliberately not seeded.
 * - Assigns brands by brand.code and franchisees by exact name. A name that
 *   matches zero or several rows aborts the whole run before anything is
 *   written: no partial mapping.
 *
 * Usage: npx dotenv -e .env -- npx tsx scripts/seed-hashavshevet-companies.ts
 */
import { eq, inArray } from "drizzle-orm";

export interface SeedCompany {
  fileName: string;
  compId: number;
  nameHe: string;
}

export const SEED_COMPANIES: SeedCompany[] = [
  // Brand management companies (targets of supplier commissions + royalties)
  { fileName: "smminna", compId: 34, nameHe: 'ש.מ מינה טומאי (ניהול מותג) בע"מ' },
  { fileName: "fv", compId: 40, nameHe: 'ויני (ניהול מותג) בע"מ' },
  { fileName: "smminna_2024", compId: 46, nameHe: 'קינג קונג (ניהול מותג) בע"מ' },
  // Franchisee companies (targets of the client exports)
  { fileName: "SHEPUDAYAROE", compId: 27, nameHe: 'קסטרא טומאיי בע"מ' },
  { fileName: "fatvini_2021", compId: 41, nameHe: "ויני עזריאלי חיפה" },
  { fileName: "kingkong_2021", compId: 43, nameHe: 'קינג קונג ביג בע"מ' },
  { fileName: "kingkong_2021_2022", compId: 45, nameHe: 'קינג קונג חורב בע"מ' },
  { fileName: "viniregba", compId: 47, nameHe: 'ויני רגבה בע"מ' },
  { fileName: "kingkong_hadera_2024", compId: 49, nameHe: 'קינג קונג חדרה בע"מ' },
  { fileName: "kingkong_hadera_2024_2026", compId: 57, nameHe: 'קינג קונג מוצקין בע"מ' },
  // Holding companies: in the table, assigned to no brand or franchisee
  { fileName: "sm", compId: 28, nameHe: "ש.מ. משאלי ניהול והשקעות" },
  { fileName: "shamim", compId: 36, nameHe: "שמיים י.ש השקעות" },
  { fileName: "sm_2026", compId: 52, nameHe: "ג'י יזמות וניהול" },
  { fileName: "sharon_mishali25", compId: 56, nameHe: "שרון משאלי" },
];

/** brand.code -> company file_name */
export const SEED_BRAND_MAP: Record<string, string> = {
  MINNA_TOMEI: "smminna",
  VINNI: "fv",
  KING_KONG: "smminna_2024",
};

/** exact franchisee.name -> company file_name */
export const SEED_FRANCHISEE_MAP: Record<string, string> = {
  'קסטרא טומאיי בע"מ': "SHEPUDAYAROE",
  "ויני עזריאלי חיפה": "fatvini_2021",
  // Same legal entity as Vini Azrieli (shared ח.פ) — booked in its company (user, 2026-10-26).
  "נתנזון עזריאלי חיפה": "fatvini_2021",
  'קינג קונג ביג בע"מ': "kingkong_2021",
  'קינג קונג חורב בע"מ': "kingkong_2021_2022",
  'ויני רגבה בע"מ': "viniregba",
  'קינג קונג חדרה בע"מ': "kingkong_hadera_2024",
  'קינג קונג מוצקין בע"מ': "kingkong_hadera_2024_2026",
};

async function main(): Promise<void> {
  // Dynamic import: importing this file (tests) must not open a DB pool.
  const { database, pool } = await import("../src/db");
  const { hashavshevetCompany, brand, franchisee } = await import(
    "../src/db/schema"
  );

  try {
    await database.transaction(async (tx) => {
      // 1. Resolve every target first; abort before writing anything.
      const brandRows = await tx
        .select({ id: brand.id, code: brand.code })
        .from(brand)
        .where(inArray(brand.code, Object.keys(SEED_BRAND_MAP)));
      for (const code of Object.keys(SEED_BRAND_MAP)) {
        if (brandRows.filter((b) => b.code === code).length !== 1) {
          throw new Error(`Brand code "${code}" did not match exactly one row`);
        }
      }

      const franchiseeNames = Object.keys(SEED_FRANCHISEE_MAP);
      const franchiseeRows = await tx
        .select({ id: franchisee.id, name: franchisee.name })
        .from(franchisee)
        .where(inArray(franchisee.name, franchiseeNames));
      for (const name of franchiseeNames) {
        if (franchiseeRows.filter((f) => f.name === name).length !== 1) {
          throw new Error(`Franchisee "${name}" did not match exactly one row`);
        }
      }

      // 2. Upsert companies. Only comp_id / name_he are ever rewritten, and
      // only when they differ, so a re-run changes nothing.
      const existing = await tx.select().from(hashavshevetCompany);
      const byFile = new Map(existing.map((c) => [c.fileName, c]));
      let inserted = 0;
      let updated = 0;
      for (const c of SEED_COMPANIES) {
        const row = byFile.get(c.fileName);
        if (!row) {
          await tx.insert(hashavshevetCompany).values(c);
          inserted++;
        } else if (row.compId !== c.compId || row.nameHe !== c.nameHe) {
          await tx
            .update(hashavshevetCompany)
            .set({ compId: c.compId, nameHe: c.nameHe, updatedAt: new Date() })
            .where(eq(hashavshevetCompany.id, row.id));
          updated++;
        }
      }

      // 3. Assign brands and franchisees.
      const companies = await tx.select().from(hashavshevetCompany);
      const idByFile = new Map(companies.map((c) => [c.fileName, c.id]));
      const companyId = (fileName: string): string => {
        const id = idByFile.get(fileName);
        if (!id) throw new Error(`Company "${fileName}" missing after upsert`);
        return id;
      };
      for (const [code, fileName] of Object.entries(SEED_BRAND_MAP)) {
        await tx
          .update(brand)
          .set({ hashavshevetCompanyId: companyId(fileName) })
          .where(eq(brand.code, code));
      }
      for (const [name, fileName] of Object.entries(SEED_FRANCHISEE_MAP)) {
        await tx
          .update(franchisee)
          .set({ hashavshevetCompanyId: companyId(fileName) })
          .where(eq(franchisee.name, name));
      }

      console.log(
        `[seed-hashavshevet] companies: ${inserted} inserted, ${updated} updated, ` +
          `${SEED_COMPANIES.length - inserted - updated} unchanged; ` +
          `${Object.keys(SEED_BRAND_MAP).length} brands and ` +
          `${franchiseeNames.length} franchisees assigned`,
      );
    });
  } finally {
    await pool.end();
  }
}

// Run only when invoked directly, not when imported by the test.
if (process.argv[1]?.endsWith("seed-hashavshevet-companies.ts")) {
  main().catch((err) => {
    console.error("[seed-hashavshevet] failed:", err);
    process.exit(1);
  });
}
