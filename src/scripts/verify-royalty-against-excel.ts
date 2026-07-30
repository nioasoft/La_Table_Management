/**
 * Read-only acceptance verification for franchisee royalty billing.
 *
 * Usage:
 *   npx tsx src/scripts/verify-royalty-against-excel.ts --year=2026 --month=6
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import * as XLSX from "xlsx";

import { canonicalStoredDecimal } from "@/lib/franchisee-billing-approval";
import {
  calculateRoyalty,
  type RoyaltyTier,
  type RoyaltyTierBasis,
} from "@/lib/royalty";

type BillingItemType = "royalty" | "marketing";
type SupportedBrandCode = "MINNA_TOMEI" | "VINNI" | "KING_KONG";
export type VerificationStatus = "תואם" | "פער" | "חסר אצלנו" | "חסר אצלה";

interface WorkbookDefinition {
  readonly fileName: string;
  readonly brandCode: SupportedBrandCode;
  readonly brandName: string;
  readonly itemType: BillingItemType;
}

const WORKBOOKS: readonly WorkbookDefinition[] = [
  {
    fileName: "מינה טומאיי תמלוגים זכיינים.xlsx",
    brandCode: "MINNA_TOMEI",
    brandName: "מינה טומאיי",
    itemType: "royalty",
  },
  {
    fileName: "מינה טומאיי שיווק זכיינים.xlsx",
    brandCode: "MINNA_TOMEI",
    brandName: "מינה טומאיי",
    itemType: "marketing",
  },
  {
    fileName: "פט ויני תמלוגים זכיינים.xlsx",
    brandCode: "VINNI",
    brandName: "פט ויני",
    itemType: "royalty",
  },
  {
    fileName: "פט ויני שיווק זכיינים.xlsx",
    brandCode: "VINNI",
    brandName: "פט ויני",
    itemType: "marketing",
  },
  {
    fileName: "קינג קונג תמלוגים זכיינים.xlsx",
    brandCode: "KING_KONG",
    brandName: "קינג קונג",
    itemType: "royalty",
  },
  {
    fileName: "קינג קונג שיווק זכיינים.xlsx",
    brandCode: "KING_KONG",
    brandName: "קינג קונג",
    itemType: "marketing",
  },
] as const;

const ITEM_KEYS: Readonly<Record<BillingItemType, string>> = {
  royalty: "הכנסותת",
  marketing: "שיווק",
};
const ITEM_LABELS: Readonly<Record<BillingItemType, string>> = {
  royalty: "תמלוגים",
  marketing: "שיווק",
};
const SUPPORTED_BRAND_CODES: readonly SupportedBrandCode[] = [
  "MINNA_TOMEI",
  "VINNI",
  "KING_KONG",
];
const REQUIRED_HEADERS = ["מפתח חשבון", "מפתח פריט", "מחיר"] as const;
const DEFAULT_SOURCE_DIRECTORY = path.join(
  process.cwd(),
  "raw_data",
  "תמלוגים זכיינים",
  "חשבשבת",
);

export interface VerificationPeriod {
  readonly year: number;
  readonly month: number;
}

export interface AcceptanceBillingRow {
  readonly billingId: string;
  readonly franchiseeName: string;
  readonly brandCode: string;
  readonly accountKeySnapshot: string | null;
  readonly receipts: string;
  readonly tips: string;
  readonly includeTips: boolean;
  readonly discountRatePoints: string;
  readonly tiersSnapshot: readonly RoyaltyTier[] | null;
  readonly tierBasisSnapshot: RoyaltyTierBasis | null;
  readonly marketingRateSnapshot: string | null;
  readonly vatRateSnapshot: string | null;
}

export interface VerificationDatabaseOperations {
  readonly readRows: (
    period: VerificationPeriod,
  ) => Promise<readonly AcceptanceBillingRow[]>;
}

export interface ComparableCharge {
  readonly brandCode: SupportedBrandCode;
  readonly brandName: string;
  readonly itemType: BillingItemType;
  readonly accountKey: string;
  readonly itemKey: string;
  readonly price: number;
}

export interface VerificationIssue {
  readonly source: string;
  readonly message: string;
}

export interface VerificationComparison {
  readonly status: VerificationStatus;
  readonly brandName: string;
  readonly itemType: BillingItemType;
  readonly accountKey: string;
  readonly ourItemKey: string;
  readonly clientItemKey: string;
  readonly ourPrice: string;
  readonly clientPrice: string;
  readonly delta: string;
}

export interface VerificationReport {
  readonly comparisons: readonly VerificationComparison[];
  readonly issues: readonly VerificationIssue[];
  readonly differenceCount: number;
}

function workbookRows(filePath: string): unknown[][] {
  const workbook = XLSX.read(fs.readFileSync(filePath), { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error(`לא נמצא גיליון בקובץ ${filePath}`);
  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: "",
  });
}

function headerIndexes(
  header: readonly unknown[],
  fileName: string,
): Readonly<Record<(typeof REQUIRED_HEADERS)[number], number>> {
  const indexes = Object.fromEntries(
    REQUIRED_HEADERS.map((label) => [label, header.indexOf(label)]),
  ) as Record<(typeof REQUIRED_HEADERS)[number], number>;
  const missing = REQUIRED_HEADERS.filter((label) => indexes[label] < 0);
  if (missing.length > 0) {
    throw new Error(`${fileName}: חסרות כותרות חובה: ${missing.join(", ")}`);
  }
  return indexes;
}

function parseWorkbook(
  directory: string,
  definition: WorkbookDefinition,
): ComparableCharge[] {
  const rows = workbookRows(path.join(directory, definition.fileName));
  const header = rows[0];
  if (!header) throw new Error(`${definition.fileName}: הקובץ ריק`);
  const indexes = headerIndexes(header, definition.fileName);

  return rows.slice(1).flatMap((row, index) => {
    const accountKey = String(row[indexes["מפתח חשבון"]] ?? "").trim();
    if (!accountKey) return [];
    const itemKey = String(row[indexes["מפתח פריט"]] ?? "").trim();
    const price = Number(row[indexes["מחיר"]]);
    if (!itemKey || !Number.isFinite(price)) {
      throw new Error(
        `${definition.fileName}, שורה ${index + 2}: מפתח פריט או מחיר אינם תקינים`,
      );
    }
    // T09 and the production export intentionally omit zero-price rows.
    if (price === 0) return [];
    return [{ ...definition, accountKey, itemKey, price }];
  });
}

/** Loads the six client workbooks without importing or accessing the database. */
export function loadClientCharges(
  directory = DEFAULT_SOURCE_DIRECTORY,
): ComparableCharge[] {
  return WORKBOOKS.flatMap((definition) =>
    parseWorkbook(directory, definition),
  );
}

function supportedBrandCode(value: string): SupportedBrandCode | null {
  return SUPPORTED_BRAND_CODES.includes(value as SupportedBrandCode)
    ? (value as SupportedBrandCode)
    : null;
}

function finiteNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} אינו מספר תקין`);
  return parsed;
}

function calculateBillingCharges(
  row: AcceptanceBillingRow,
): ComparableCharge[] {
  const brandCode = supportedBrandCode(row.brandCode);
  const accountKey = row.accountKeySnapshot?.trim();
  if (!brandCode) throw new Error(`קוד המותג ${row.brandCode} אינו נתמך`);
  if (!accountKey) throw new Error("מפתח החשבון בצילום האישור חסר");
  if (!row.tiersSnapshot || !row.tierBasisSnapshot) {
    throw new Error("צילום מדרגות התמלוגים חסר");
  }
  if (row.marketingRateSnapshot === null || row.vatRateSnapshot === null) {
    throw new Error("צילום שיעור השיווק או המע״מ חסר");
  }

  const calculation = calculateRoyalty({
    receipts: finiteNumber(row.receipts, "תקבולים"),
    tips: finiteNumber(row.tips, "טיפים"),
    includeTips: row.includeTips,
    tiers: row.tiersSnapshot,
    tierBasis: row.tierBasisSnapshot,
    marketingRate: finiteNumber(row.marketingRateSnapshot, "שיעור שיווק"),
    discountRatePoints: finiteNumber(row.discountRatePoints, "נקודות הנחה"),
    vat: finiteNumber(row.vatRateSnapshot, "שיעור מע״מ"),
  });
  const brandName =
    WORKBOOKS.find((workbook) => workbook.brandCode === brandCode)?.brandName ??
    brandCode;

  return (["royalty", "marketing"] as const).flatMap((itemType) => {
    const price = calculation[itemType];
    if (price === 0) return [];
    return [
      {
        brandCode,
        brandName,
        itemType,
        accountKey,
        itemKey: ITEM_KEYS[itemType],
        price,
      },
    ];
  });
}

/** Re-runs the royalty engine and reports invalid snapshots without hiding them. */
export function calculateSystemCharges(rows: readonly AcceptanceBillingRow[]): {
  readonly charges: readonly ComparableCharge[];
  readonly issues: readonly VerificationIssue[];
} {
  const charges: ComparableCharge[] = [];
  const issues: VerificationIssue[] = [];
  for (const row of rows) {
    try {
      charges.push(...calculateBillingCharges(row));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({
        source: `${row.franchiseeName} (${row.billingId})`,
        message,
      });
    }
  }
  return { charges, issues };
}

function chargeKey(charge: ComparableCharge): string {
  return [charge.brandCode, charge.itemType, charge.accountKey].join("\u0000");
}

function uniqueChargeMap(
  charges: readonly ComparableCharge[],
  side: string,
  issues: VerificationIssue[],
): ReadonlyMap<string, ComparableCharge> {
  const grouped = new Map<string, ComparableCharge[]>();
  for (const charge of charges) {
    const key = chargeKey(charge);
    grouped.set(key, [...(grouped.get(key) ?? []), charge]);
  }
  for (const [key, matches] of grouped) {
    if (matches.length > 1) {
      issues.push({
        source: side,
        message: `נמצאו ${matches.length} שורות לאותו מפתח השוואה: ${key.split("\u0000").join(" / ")}`,
      });
    }
  }
  return new Map(
    [...grouped].flatMap(([key, matches]) =>
      matches.length === 1 ? [[key, matches[0]] as const] : [],
    ),
  );
}

function signedDelta(ours: string, client: string): string {
  const delta = canonicalStoredDecimal(Number(ours) - Number(client), 6);
  return Number(delta) > 0 ? `+${delta}` : delta;
}

function comparePair(
  ours: ComparableCharge | undefined,
  client: ComparableCharge | undefined,
): VerificationComparison {
  const reference = ours ?? client;
  if (!reference) throw new Error("נוצר מפתח השוואה ללא שורה");
  const ourPrice = ours ? canonicalStoredDecimal(ours.price, 6) : "—";
  const clientPrice = client ? canonicalStoredDecimal(client.price, 6) : "—";
  const sameItem = ours?.itemKey === client?.itemKey;
  const samePrice = ourPrice === clientPrice;
  const status: VerificationStatus = !ours
    ? "חסר אצלנו"
    : !client
      ? "חסר אצלה"
      : sameItem && samePrice
        ? "תואם"
        : "פער";
  return {
    status,
    brandName: reference.brandName,
    itemType: reference.itemType,
    accountKey: reference.accountKey,
    ourItemKey: ours?.itemKey ?? "—",
    clientItemKey: client?.itemKey ?? "—",
    ourPrice,
    clientPrice,
    delta: ours && client ? signedDelta(ourPrice, clientPrice) : "—",
  };
}

/** Compares exact PostgreSQL numeric(16,6) representations, as T09 does. */
export function compareCharges(
  systemCharges: readonly ComparableCharge[],
  clientCharges: readonly ComparableCharge[],
  initialIssues: readonly VerificationIssue[] = [],
): VerificationReport {
  const issues = [...initialIssues];
  const ours = uniqueChargeMap(systemCharges, "המערכת", issues);
  const client = uniqueChargeMap(clientCharges, "קבצי הלקוחה", issues);
  const keys = [...new Set([...ours.keys(), ...client.keys()])].sort();
  const comparisons = keys.map((key) =>
    comparePair(ours.get(key), client.get(key)),
  );
  const mismatches = comparisons.filter(
    (comparison) => comparison.status !== "תואם",
  ).length;
  return {
    comparisons,
    issues,
    differenceCount: mismatches + issues.length,
  };
}

/** Produces console.table-compatible Hebrew report rows. */
export function formatReportRows(
  comparisons: readonly VerificationComparison[],
): readonly Readonly<Record<string, string>>[] {
  return comparisons.map((comparison) => ({
    סטטוס: comparison.status,
    מותג: comparison.brandName,
    סוג: ITEM_LABELS[comparison.itemType],
    "מפתח חשבון": comparison.accountKey,
    "מפתח פריט אצלנו": comparison.ourItemKey,
    "מפתח פריט אצלה": comparison.clientItemKey,
    "מחיר אצלנו": comparison.ourPrice,
    "מחיר אצלה": comparison.clientPrice,
    "דלתא (שלנו פחות שלה)": comparison.delta,
  }));
}

export async function executeVerification(
  period: VerificationPeriod,
  clientCharges: readonly ComparableCharge[],
  operations: VerificationDatabaseOperations,
): Promise<VerificationReport> {
  const calculated = calculateSystemCharges(await operations.readRows(period));
  return compareCharges(calculated.charges, clientCharges, calculated.issues);
}

export function parsePeriod(args: readonly string[]): VerificationPeriod {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--(year|month)=(\d+)$/.exec(argument);
    if (!match) throw new Error(`דגל לא מוכר: ${argument}`);
    values.set(match[1], match[2]);
  }
  const year = Number(values.get("year"));
  const month = Number(values.get("month"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("יש להעביר שנה תקינה באמצעות ‎--year=YYYY");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("יש להעביר חודש תקין באמצעות ‎--month=M");
  }
  return { year, month };
}

async function loadRuntime() {
  return Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("drizzle-orm"),
  ]);
}

type VerificationRuntime = Awaited<ReturnType<typeof loadRuntime>>;

function createDatabaseOperations(
  runtime: VerificationRuntime,
): VerificationDatabaseOperations {
  const [{ database }, schema, { and, eq, inArray }] = runtime;
  return {
    readRows: async (period) =>
      database
        .select({
          billingId: schema.franchiseeBilling.id,
          franchiseeName: schema.franchisee.name,
          brandCode: schema.brand.code,
          accountKeySnapshot: schema.franchiseeBilling.accountKeySnapshot,
          receipts: schema.franchiseeBilling.receipts,
          tips: schema.franchiseeBilling.tips,
          includeTips: schema.franchiseeBilling.includeTips,
          discountRatePoints: schema.franchiseeBilling.discountRatePoints,
          tiersSnapshot: schema.franchiseeBilling.tiersSnapshot,
          tierBasisSnapshot: schema.franchiseeBilling.tierBasisSnapshot,
          marketingRateSnapshot: schema.franchiseeBilling.marketingRateSnapshot,
          vatRateSnapshot: schema.franchiseeBilling.vatRateSnapshot,
        })
        .from(schema.franchiseeBilling)
        .innerJoin(
          schema.franchisee,
          eq(schema.franchiseeBilling.franchiseeId, schema.franchisee.id),
        )
        .innerJoin(schema.brand, eq(schema.franchisee.brandId, schema.brand.id))
        .where(
          and(
            eq(schema.franchiseeBilling.periodYear, period.year),
            eq(schema.franchiseeBilling.periodMonth, period.month),
            eq(schema.franchiseeBilling.status, "approved"),
            inArray(schema.brand.code, [...SUPPORTED_BRAND_CODES]),
          ),
        ),
  };
}

function presentReport(
  period: VerificationPeriod,
  report: VerificationReport,
): void {
  console.info(`\nאימות תמלוגים ושיווק לתקופה ${period.month}/${period.year}:`);
  console.table(formatReportRows(report.comparisons));
  if (report.issues.length > 0) {
    console.error("\nבעיות שמנעו השוואה:");
    console.table(
      report.issues.map((issue) => ({
        מקור: issue.source,
        בעיה: issue.message,
      })),
    );
  }
  const matches =
    report.comparisons.length -
    report.comparisons.filter((row) => row.status !== "תואם").length;
  console.info(
    `\nסיכום: ${matches} תואמות, ${report.differenceCount} פערים או בעיות.`,
  );
}

async function main(): Promise<void> {
  const period = parsePeriod(process.argv.slice(2));
  const clientCharges = loadClientCharges();
  const runtime = await loadRuntime();
  const [{ pool }] = runtime;
  try {
    const report = await executeVerification(
      period,
      clientCharges,
      createDatabaseOperations(runtime),
    );
    presentReport(period, report);
    if (report.differenceCount > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`אימות התמלוגים נכשל: ${message}`);
    process.exitCode = 1;
  });
}
