/**
 * One-off royalty configuration seed.
 *
 * Usage:
 *   npx tsx src/scripts/seed-royalty-config.ts             # offline dry-run
 *   npx tsx src/scripts/seed-royalty-config.ts --dry-run   # offline dry-run
 *   npx tsx src/scripts/seed-royalty-config.ts --verify    # DB read-only diff
 *   npx tsx src/scripts/seed-royalty-config.ts --apply     # verify DB aliases and write
 */

import { pathToFileURL } from "node:url";
import type { RoyaltyTier, RoyaltyTierBasis } from "@/lib/royalty";

export type SeedMode = "dry-run" | "verify" | "apply";
type DatabaseSeedMode = Exclude<SeedMode, "dry-run">;

const VINNI_BOUNDARY_NOTE =
  "קונבנציית הגבול בכל רפי הסולם יושרה מ־< ל־<=; קודם מחזור השווה לרף עבר למדרגה הבאה.";

interface AccountMapping {
  readonly key: string;
  readonly evidenceAliases: readonly string[];
}

export interface RoyaltySeedConfig {
  readonly label: string;
  readonly brandCode: "MINNA_TOMEI" | "VINNI" | "KING_KONG" | "NATANZON";
  readonly matchNames: readonly string[];
  readonly marketingFeeRate: "0.00" | "1.00";
  readonly royaltyTiers: readonly RoyaltyTier[] | null;
  readonly account?: AccountMapping;
  readonly normalizationNote: string | null;
}

const account = (
  key: string,
  ...evidenceAliases: readonly string[]
): AccountMapping => ({ key, evidenceAliases });

export const ROYALTY_SEED_CONFIGS: readonly RoyaltySeedConfig[] = [
  {
    label: "מינה טומאיי יהוד",
    brandCode: "MINNA_TOMEI",
    matchNames: [
      "מינה טומאיי יהוד",
      "מינה טומיי יהוד",
      "מינה טומי יהוד",
      'אושיבה בע"מ',
    ],
    marketingFeeRate: "1.00",
    royaltyTiers: [
      { upTo: 700_000, rate: 0 },
      { upTo: null, rate: 5 },
    ],
    account: account("אושיבה", 'אושיבה בע"מ'),
    normalizationNote:
      "נסגר החור 700,000 < מחזור < 700,001; קודם הנוסחה החזירה FALSE בטווח הזה.",
  },
  {
    label: "מינה טומאיי עין שמר",
    brandCode: "MINNA_TOMEI",
    matchNames: [
      "מינה טומאיי עין שמר",
      "מינה טומיי עין שמר",
      'מינה טומיי עין שמר בע"מ',
    ],
    marketingFeeRate: "1.00",
    royaltyTiers: [
      { upTo: 700_000, rate: 0 },
      { upTo: 1_200_000, rate: 3.5 },
      { upTo: null, rate: 4 },
    ],
    normalizationNote:
      "נסגר החור 1,200,000 < מחזור < 1,200,001; קודם הנוסחה החזירה FALSE בטווח הזה.",
  },
  {
    label: "מינה טומאיי שרונה",
    brandCode: "MINNA_TOMEI",
    matchNames: ["מינה טומאיי שרונה", "מינה טומיי שרונה", 'מינה שרונה בע"מ'],
    marketingFeeRate: "1.00",
    royaltyTiers: [
      { upTo: 1_200_000, rate: 2.5 },
      { upTo: null, rate: 3 },
    ],
    normalizationNote:
      "נסגר החור 1,200,000 < מחזור < 1,200,001; קודם הנוסחה החזירה FALSE בטווח הזה.",
  },
  {
    label: "מינה טומאיי קסטרא",
    brandCode: "MINNA_TOMEI",
    matchNames: ["מינה טומאיי קסטרא", "מינה טומיי קסטרא", 'קסטרא טומאיי בע"מ'],
    marketingFeeRate: "1.00",
    royaltyTiers: [{ upTo: null, rate: 3 }],
    account: account("מינה", 'קסטרא טומאיי בע"מ'),
    normalizationNote: null,
  },
  {
    label: "מינה טומאיי קריון",
    brandCode: "MINNA_TOMEI",
    matchNames: [
      "מינה טומאיי קריון",
      "מינה טומיי קריון",
      'אודון ניהול ואחזקות בע"מ',
    ],
    marketingFeeRate: "1.00",
    royaltyTiers: [{ upTo: null, rate: 4 }],
    account: account("אודון", 'אודון ניהול ואחזקות בע"מ'),
    normalizationNote: null,
  },
  ...[
    ["ויני חדרה", ['דארת בע"מ', "פט ויני חדרה"], "ויני חדרה"],
    ["ויני יהוד", ['טמפר הסעדה בע"מ', "פט ויני יהוד"], "טמפר"],
    ["ויני נתניה", ['סידיוס בע"מ', "פט ויני נתניה"], "סידיוס"],
    ["ויני קריית אתא", ['מיאמוטו בע"מ', "פט ויני קריית אתא"], "מיאמוטו"],
  ].map(([label, matchNames, accountKey]) => ({
    label: label as string,
    brandCode: "VINNI" as const,
    matchNames: [label as string, ...(matchNames as string[])],
    marketingFeeRate: "1.00" as const,
    royaltyTiers: [
      { upTo: 500_000, rate: 0 },
      { upTo: 600_000, rate: 4 },
      { upTo: 700_000, rate: 4.5 },
      { upTo: null, rate: 5 },
    ],
    account:
      accountKey === "ויני חדרה"
        ? undefined
        : account(accountKey as string, (matchNames as string[])[0]),
    normalizationNote: VINNI_BOUNDARY_NOTE,
  })),
  ...[
    ["ויני כרמיאל", ["פט ויני כרמיאל", 'ויני כרמיאל בע"מ']],
    ["ויני רגבה", ['ויני רגבה בע"מ', "פט ויני רגבה"]],
  ].map(([label, matchNames]) => ({
    label: label as string,
    brandCode: "VINNI" as const,
    matchNames: [label as string, ...(matchNames as string[])],
    marketingFeeRate: "1.00" as const,
    royaltyTiers: [
      { upTo: 550_000, rate: 0 },
      { upTo: 700_000, rate: 4 },
      { upTo: null, rate: 4.5 },
    ],
    normalizationNote: VINNI_BOUNDARY_NOTE,
  })),
  {
    label: "ויני עזריאלי חיפה",
    brandCode: "VINNI",
    matchNames: [
      "ויני עזריאלי חיפה",
      "פט ויני עזריאלי חיפה",
      'פט ויני עזריאלי בע"מ-חיפה',
    ],
    marketingFeeRate: "1.00",
    royaltyTiers: [{ upTo: null, rate: 3 }],
    account: account("פט ויני ע", 'פט ויני עזריאלי בע"מ-חיפה'),
    normalizationNote: null,
  },
  {
    label: "קינג קונג כרמיאל",
    brandCode: "KING_KONG",
    matchNames: ["קינג קונג כרמיאל", 'קינג כרמיאל בע"מ'],
    marketingFeeRate: "1.00",
    royaltyTiers: [
      { upTo: 550_000, rate: 0 },
      { upTo: 1_000_000, rate: 4.5 },
      { upTo: null, rate: 5 },
    ],
    normalizationNote:
      "נסגר החור במחזור 1,000,000; קודם הנוסחה דילגה בין <1,000,000 ל־>=1,000,000.001.",
  },
  {
    label: "קינג קונג נהריה",
    brandCode: "KING_KONG",
    matchNames: ["קינג קונג נהריה", "קינג נהריה", 'קינג געתון בע"מ'],
    marketingFeeRate: "1.00",
    royaltyTiers: [
      { upTo: 550_000, rate: 0 },
      { upTo: 850_000, rate: 4.5 },
      { upTo: null, rate: 5 },
    ],
    account: account("קינג ג", 'קינג געתון בע"מ'),
    normalizationNote:
      "נסגר החור 850,000 ≤ מחזור < 850,001; קודם הנוסחה החזירה FALSE בטווח הזה.",
  },
  {
    label: "קינג קונג רעננה",
    brandCode: "KING_KONG",
    matchNames: ["קינג קונג רעננה", 'אטפה בע"מ', "ק.ק מסעדה אסייתית רעננה"],
    marketingFeeRate: "1.00",
    royaltyTiers: [
      { upTo: 700_000, rate: 0 },
      { upTo: null, rate: 5 },
    ],
    account: account("ק.ק מסעדה", 'ק.ק מסעדה אסייתית רעננה בע"מ'),
    normalizationNote:
      "הושלם הענף החסר למחזור 7,000,000 ומעלה, והרף 700,000.009 יושר ל־700,000 כולל.",
  },
  ...[
    ["קינג קונג חדרה", ["קינג קונג חדרה בע״מ"], "קינג ח"],
    ["קינג קונג חורב", ["קינג קונג חורב בע״מ"], undefined],
    ["קינג קונג ביג קריות", ['קינג קונג ביג בע"מ', "קינג ביג"], "קינג ב"],
  ].map(([label, aliases, accountKey]) => ({
    label: label as string,
    brandCode: "KING_KONG" as const,
    matchNames: [label as string, ...(aliases as string[])],
    marketingFeeRate: "1.00" as const,
    royaltyTiers: [{ upTo: null, rate: 3 }],
    account: accountKey
      ? account(accountKey as string, (aliases as string[])[0])
      : undefined,
    normalizationNote: null,
  })),
  {
    label: "קינג קונג עפולה",
    brandCode: "KING_KONG",
    matchNames: ["קינג קונג עפולה", "קינג עפולה"],
    marketingFeeRate: "1.00",
    royaltyTiers: [{ upTo: null, rate: 4.5 }],
    account: account("קינג עפולה", "קינג עפולה"),
    normalizationNote: null,
  },
  {
    label: "קינג קונג מוצקין",
    brandCode: "KING_KONG",
    matchNames: ["קינג קונג מוצקין", "קינג קונג קריית מוצקין", "קינג מוצקין"],
    marketingFeeRate: "1.00",
    royaltyTiers: null,
    account: account("קינג מ", "קינג מוצקין"),
    normalizationNote: null,
  },
  {
    label: "נתנזון עזריאלי חיפה",
    brandCode: "NATANZON",
    matchNames: ["נתנזון עזריאלי חיפה", "נתנזון בורגר"],
    marketingFeeRate: "0.00",
    royaltyTiers: [{ upTo: null, rate: 0 }],
    normalizationNote: null,
  },
];

export interface SeedFranchiseeRow {
  readonly id: string;
  readonly name: string;
  readonly brandCode: string;
  readonly aliases: readonly string[] | null;
  readonly marketingFeeRate: string | null;
  readonly royaltyTiers: readonly RoyaltyTier[] | null;
  readonly royaltyTierBasis: RoyaltyTierBasis;
  readonly royaltyTiersConfirmed: boolean;
  readonly royaltyTiersNote: string | null;
  readonly hashavshevetAccountKey: string | null;
}

export interface SeedPatch {
  marketingFeeRate?: string;
  royaltyTiers?: RoyaltyTier[] | null;
  royaltyTierBasis?: RoyaltyTierBasis;
  royaltyTiersConfirmed?: boolean;
  royaltyTiersNote?: string | null;
  hashavshevetAccountKey?: string;
}

const BRAND_LABELS: Record<RoyaltySeedConfig["brandCode"], string> = {
  MINNA_TOMEI: "מינה טומאיי",
  VINNI: "ויני",
  KING_KONG: "קינג קונג",
  NATANZON: "נתנזון",
};

const PATCH_LABELS: Record<keyof SeedPatch, string> = {
  marketingFeeRate: "אחוז שיווק",
  royaltyTiers: "מדרגות",
  royaltyTierBasis: "בסיס מדרגות",
  royaltyTiersConfirmed: "מצב אישור",
  royaltyTiersNote: "הערת נרמול",
  hashavshevetAccountKey: "מפתח חשבון",
};

export interface SeedPlanEntry {
  readonly row: SeedFranchiseeRow;
  readonly config: RoyaltySeedConfig;
  readonly patch: SeedPatch;
  readonly status: "לעדכון" | "ללא שינוי" | "מוגן — כבר אושר";
  readonly accountWarning: string | null;
}

export interface SeedPlan {
  readonly entries: readonly SeedPlanEntry[];
  readonly errors: readonly string[];
}

export interface SeedDelta {
  readonly franchisee: string;
  readonly field: keyof SeedPatch;
  readonly fieldLabel: string;
  readonly fromValue: string;
  readonly toValue: string;
}

export interface SeedDatabaseOperations {
  readonly readRows: () => Promise<readonly SeedFranchiseeRow[]>;
  readonly writeEntries: (entries: readonly SeedPlanEntry[]) => Promise<number>;
  readonly presentPlan: (plan: SeedPlan, deltas: readonly SeedDelta[]) => void;
}

export interface SeedExecutionResult {
  readonly plan: SeedPlan;
  readonly deltas: readonly SeedDelta[];
  readonly updated: number;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("he")
    .replace(/בע[\"״']?מ/g, "")
    .replace(/[\"״'׳().\-–—]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rowMatchesConfig(
  row: SeedFranchiseeRow,
  config: RoyaltySeedConfig,
): boolean {
  if (row.brandCode !== config.brandCode) return false;
  const rowNames = [row.name, ...(row.aliases ?? [])].map(normalizeName);
  return config.matchNames.some((name) =>
    rowNames.includes(normalizeName(name)),
  );
}

function hasAccountEvidence(
  row: SeedFranchiseeRow,
  mapping: AccountMapping,
): boolean {
  const aliases = (row.aliases ?? []).map(normalizeName);
  return mapping.evidenceAliases.some((alias) =>
    aliases.includes(normalizeName(alias)),
  );
}

function sameTiers(
  current: readonly RoyaltyTier[] | null,
  target: readonly RoyaltyTier[] | null,
): boolean {
  return JSON.stringify(current) === JSON.stringify(target);
}

function sameDecimal(current: string | null, target: string): boolean {
  return current !== null && Number(current) === Number(target);
}

function createPatch(
  row: SeedFranchiseeRow,
  config: RoyaltySeedConfig,
  mapping: AccountMapping | undefined,
  accountVerified: boolean,
): SeedPatch {
  const fieldChanges: SeedPatch = {
    ...(!sameDecimal(row.marketingFeeRate, config.marketingFeeRate)
      ? { marketingFeeRate: config.marketingFeeRate }
      : {}),
    ...(!sameTiers(row.royaltyTiers, config.royaltyTiers)
      ? {
          royaltyTiers:
            config.royaltyTiers?.map((tier) => ({ ...tier })) ?? null,
        }
      : {}),
    ...(row.royaltyTierBasis !== "gross"
      ? { royaltyTierBasis: "gross" as const }
      : {}),
    ...(row.royaltyTiersNote !== config.normalizationNote
      ? { royaltyTiersNote: config.normalizationNote }
      : {}),
    ...(mapping && accountVerified && row.hashavshevetAccountKey !== mapping.key
      ? { hashavshevetAccountKey: mapping.key }
      : {}),
  };
  return Object.keys(fieldChanges).length > 0
    ? { ...fieldChanges, royaltyTiersConfirmed: false }
    : fieldChanges;
}

function createPlanEntry(
  row: SeedFranchiseeRow,
  config: RoyaltySeedConfig,
): SeedPlanEntry {
  const mapping = config.account;
  const accountVerified = !mapping || hasAccountEvidence(row, mapping);
  const accountWarning =
    mapping && !accountVerified
      ? `מפתח "${mapping.key}" דולג: לא נמצא כינוי מאמת`
      : null;

  if (row.royaltyTiersConfirmed) {
    return {
      row,
      config,
      patch: {},
      status: "מוגן — כבר אושר",
      accountWarning,
    };
  }

  const patch = createPatch(row, config, mapping, accountVerified);

  return {
    row,
    config,
    patch,
    status: Object.keys(patch).length === 0 ? "ללא שינוי" : "לעדכון",
    accountWarning,
  };
}

export function buildSeedPlan(rows: readonly SeedFranchiseeRow[]): SeedPlan {
  const matches = ROYALTY_SEED_CONFIGS.map((config) => ({
    config,
    rows: rows.filter((row) => rowMatchesConfig(row, config)),
  }));
  const singular = matches.filter((match) => match.rows.length === 1);
  const unique = singular.filter(
    (match) =>
      singular.filter((other) => other.rows[0].id === match.rows[0].id)
        .length === 1,
  );
  const entries = unique.map((match) =>
    createPlanEntry(match.rows[0], match.config),
  );
  const matchedIds = entries.map((entry) => entry.row.id);
  const errors = [
    ...matches
      .filter((match) => match.rows.length !== 1)
      .map(
        (match) =>
          `${match.config.label}: נמצאו ${match.rows.length} רשומות פעילות במקום רשומה אחת`,
      ),
    ...singular
      .filter((match) => !unique.includes(match))
      .map(
        (match) =>
          `${match.config.label}: אותה רשומת מסד נתונים הותאמה ליותר מקונפיגורציה אחת`,
      ),
    ...rows
      .filter((row) => !matchedIds.includes(row.id))
      .map((row) => `${row.name}: זכיין פעיל ללא קונפיגורציית זריעה`),
    ...(rows.length !== ROYALTY_SEED_CONFIGS.length
      ? [
          `נמצאו ${rows.length} זכיינים פעילים; הסקריפט מצפה ל־${ROYALTY_SEED_CONFIGS.length}`,
        ]
      : []),
  ];
  return { entries, errors };
}

function formatDeltaValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function buildSeedDeltas(
  entries: readonly SeedPlanEntry[],
): SeedDelta[] {
  return entries.flatMap((entry) =>
    (Object.keys(entry.patch) as Array<keyof SeedPatch>).flatMap((field) => {
      const fromValue = entry.row[field];
      const toValue = entry.patch[field];
      if (JSON.stringify(fromValue) === JSON.stringify(toValue)) return [];
      return [
        {
          franchisee: entry.config.label,
          field,
          fieldLabel: PATCH_LABELS[field],
          fromValue: formatDeltaValue(fromValue),
          toValue: formatDeltaValue(toValue),
        },
      ];
    }),
  );
}

function formatTiers(tiers: readonly RoyaltyTier[] | null): string {
  if (tiers === null) return "ללא סולם";
  return tiers
    .map((tier) =>
      tier.upTo === null
        ? `מעל: ${tier.rate}%`
        : `עד ${tier.upTo.toLocaleString("he-IL")}: ${tier.rate}%`,
    )
    .join(" | ");
}

function printOfflinePlan(): void {
  console.log("מצב dry-run אופליין — לא תתבצע קריאה או כתיבה למסד הנתונים.");
  console.table(
    ROYALTY_SEED_CONFIGS.map((config) => ({
      זכיין: config.label,
      מותג: BRAND_LABELS[config.brandCode],
      שיווק: `${config.marketingFeeRate}%`,
      מדרגות: formatTiers(config.royaltyTiers),
      בסיס: "ברוטו",
      מאושר: false,
      "מפתח חשבון": config.account?.key ?? "—",
      "הערת נרמול": config.normalizationNote ?? "—",
    })),
  );
  console.log(
    `סה״כ ${ROYALTY_SEED_CONFIGS.length} זכיינים. לדלתא מול מסד הנתונים יש להעביר --verify; לכתיבה --apply.`,
  );
}

function printDatabasePlan(plan: SeedPlan, deltas: readonly SeedDelta[]): void {
  console.info("\nדלתא מול מסד הנתונים — שדות שישתנו בלבד:");
  if (deltas.length > 0) {
    console.table(
      deltas.map((delta) => ({
        זכיין: delta.franchisee,
        שדה: delta.fieldLabel,
        "מ־ערך": delta.fromValue,
        "ל־ערך": delta.toValue,
      })),
    );
  } else {
    console.info("אין שינויים.");
  }

  const confirmed = plan.entries.filter(
    (entry) => entry.status === "מוגן — כבר אושר",
  );
  console.info("\nזכיינים שדולגו כי הסולם כבר אושר:");
  console.table(confirmed.map((entry) => ({ זכיין: entry.config.label })));

  const accountWarnings = plan.entries.filter((entry) => entry.accountWarning);
  console.info("\nמיפויי מפתח חשבון שלא אומתו:");
  console.table(
    accountWarnings.map((entry) => ({
      זכיין: entry.config.label,
      סיבה: entry.accountWarning,
    })),
  );
}

async function loadRuntime() {
  return Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("drizzle-orm"),
  ]);
}

function assertPlanIsWritable(plan: SeedPlan): void {
  if (plan.errors.length > 0) {
    throw new Error(`התוכנית אינה תקינה:\n${plan.errors.join("\n")}`);
  }
}

type SeedRuntime = Awaited<ReturnType<typeof loadRuntime>>;

function createDatabaseOperations(
  runtime: SeedRuntime,
): SeedDatabaseOperations {
  const [{ database }, { brand, franchisee }, { and, eq }] = runtime;
  return {
    readRows: async () => {
      const records = await database
        .select({ row: franchisee, brandCode: brand.code })
        .from(franchisee)
        .innerJoin(brand, eq(franchisee.brandId, brand.id))
        .where(
          and(
            eq(franchisee.isActive, true),
            eq(franchisee.category, "regular"),
          ),
        );
      return records.map(({ row, brandCode }) => ({ ...row, brandCode }));
    },
    writeEntries: async (entries) =>
      database.transaction(async (tx) => {
        const results = await Promise.all(
          entries.map((entry) =>
            tx
              .update(franchisee)
              .set({ ...entry.patch, updatedAt: new Date() })
              .where(
                and(
                  eq(franchisee.id, entry.row.id),
                  eq(franchisee.royaltyTiersConfirmed, false),
                ),
              )
              .returning({ id: franchisee.id }),
          ),
        );
        if (results.some((result) => result.length !== 1)) {
          throw new Error("אחד הסולמות אושר במקביל; לא בוצעה אף כתיבה.");
        }
        return results.length;
      }),
    presentPlan: printDatabasePlan,
  };
}

export async function executeDatabaseSeed(
  mode: DatabaseSeedMode,
  operations: SeedDatabaseOperations,
): Promise<SeedExecutionResult> {
  const plan = buildSeedPlan(await operations.readRows());
  const deltas = buildSeedDeltas(plan.entries);
  operations.presentPlan(plan, deltas);
  assertPlanIsWritable(plan);
  if (mode === "verify") return { plan, deltas, updated: 0 };
  const entries = plan.entries.filter((entry) => entry.status === "לעדכון");
  const updated = await operations.writeEntries(entries);
  return { plan, deltas, updated };
}

async function runDatabaseSeed(mode: DatabaseSeedMode): Promise<void> {
  const runtime = await loadRuntime();
  const [{ pool }] = runtime;
  try {
    const result = await executeDatabaseSeed(
      mode,
      createDatabaseOperations(runtime),
    );
    console.info(
      mode === "verify"
        ? "האימות הושלם בקריאה בלבד; לא בוצעה כתיבה."
        : `הזריעה הסתיימה: ${result.updated} זכיינים עודכנו.`,
    );
  } finally {
    await pool.end();
  }
}

export function parseSeedMode(args: readonly string[]): SeedMode {
  const allowed = new Set(["--dry-run", "--verify", "--apply"]);
  const unknown = args.filter((arg) => !allowed.has(arg));
  if (unknown.length > 0) throw new Error(`דגל לא מוכר: ${unknown.join(", ")}`);
  if (args.length > 1) {
    throw new Error("יש להעביר לכל היותר דגל מצב אחד");
  }
  if (args.includes("--verify")) return "verify";
  return args.includes("--apply") ? "apply" : "dry-run";
}

async function main(): Promise<void> {
  const mode = parseSeedMode(process.argv.slice(2));
  if (mode === "dry-run") {
    printOfflinePlan();
    return;
  }
  await runDatabaseSeed(mode);
}

const isMainModule =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`שגיאה בזריעת קונפיגורציית התמלוגים: ${message}`);
    process.exitCode = 1;
  });
}
