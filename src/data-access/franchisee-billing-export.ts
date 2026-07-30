import { and, asc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type {
  BrandExportContext,
  ExportBillingRow,
  HashavshevetExportInput,
  HashavshevetExportOperations,
  HashavshevetExportStore,
  PersistExportInput,
} from "@/app/api/franchisee-billing/hashavshevet-export/route";
import * as schema from "@/db/schema";
import type { FranchiseeBillingPeriod } from "@/schemas/franchisee-billing-screen";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SUPPORTED_BRAND_CODES = [
  "MINNA_TOMEI",
  "VINNI",
  "KING_KONG",
] as const;

type ExportDatabase = NodePgDatabase<typeof schema>;

interface ActiveFranchisee {
  readonly id: string;
  readonly name: string;
  readonly brandId: string;
}

interface PeriodBilling {
  readonly id: string;
  readonly franchiseeId: string;
  readonly accountKeySnapshot: string | null;
  readonly status: schema.FranchiseeBillingStatus;
  readonly noRevenueReason: string | null;
  readonly royalty: string;
  readonly marketing: string;
  readonly total: string;
}

async function readBrands(database: ExportDatabase) {
  return database
    .select({
      id: schema.brand.id,
      code: schema.brand.code,
      name: schema.brand.nameHe,
    })
    .from(schema.brand)
    .where(
      and(
        inArray(schema.brand.code, [...SUPPORTED_BRAND_CODES]),
        eq(schema.brand.isActive, true),
      ),
    )
    .orderBy(asc(schema.brand.nameHe));
}

function activeFranchiseeConditions(brandId?: string) {
  return and(
    ...(brandId ? [eq(schema.franchisee.brandId, brandId)] : []),
    eq(schema.franchisee.category, "regular"),
    eq(schema.franchisee.status, "active"),
    eq(schema.franchisee.isActive, true),
  );
}

async function readActiveFranchisees(
  database: ExportDatabase,
  brandId?: string,
): Promise<readonly ActiveFranchisee[]> {
  return database
    .select({
      id: schema.franchisee.id,
      name: schema.franchisee.name,
      brandId: schema.franchisee.brandId,
    })
    .from(schema.franchisee)
    .where(activeFranchiseeConditions(brandId))
    .orderBy(asc(schema.franchisee.name));
}

async function readLockedActiveFranchisees(
  database: ExportDatabase,
  brandId: string,
): Promise<readonly ActiveFranchisee[]> {
  return database
    .select({
      id: schema.franchisee.id,
      name: schema.franchisee.name,
      brandId: schema.franchisee.brandId,
    })
    .from(schema.franchisee)
    .where(activeFranchiseeConditions(brandId))
    .orderBy(asc(schema.franchisee.name))
    .for("share");
}

function periodBillingConditions(
  period: FranchiseeBillingPeriod,
  franchiseeIds?: readonly string[],
) {
  return and(
    ...(franchiseeIds
      ? [inArray(schema.franchiseeBilling.franchiseeId, [...franchiseeIds])]
      : []),
    eq(schema.franchiseeBilling.periodYear, period.year),
    eq(schema.franchiseeBilling.periodMonth, period.month),
  );
}

async function readPeriodBillings(
  database: ExportDatabase,
  period: FranchiseeBillingPeriod,
  franchiseeIds?: readonly string[],
): Promise<readonly PeriodBilling[]> {
  if (franchiseeIds?.length === 0) return [];
  return database
    .select({
      id: schema.franchiseeBilling.id,
      franchiseeId: schema.franchiseeBilling.franchiseeId,
      accountKeySnapshot: schema.franchiseeBilling.accountKeySnapshot,
      status: schema.franchiseeBilling.status,
      noRevenueReason: schema.franchiseeBilling.noRevenueReason,
      royalty: schema.franchiseeBilling.royalty,
      marketing: schema.franchiseeBilling.marketing,
      total: schema.franchiseeBilling.total,
    })
    .from(schema.franchiseeBilling)
    .where(periodBillingConditions(period, franchiseeIds));
}

async function readLockedPeriodBillings(
  database: ExportDatabase,
  period: FranchiseeBillingPeriod,
  franchiseeIds: readonly string[],
): Promise<readonly PeriodBilling[]> {
  if (franchiseeIds.length === 0) return [];
  return database
    .select({
      id: schema.franchiseeBilling.id,
      franchiseeId: schema.franchiseeBilling.franchiseeId,
      accountKeySnapshot: schema.franchiseeBilling.accountKeySnapshot,
      status: schema.franchiseeBilling.status,
      noRevenueReason: schema.franchiseeBilling.noRevenueReason,
      royalty: schema.franchiseeBilling.royalty,
      marketing: schema.franchiseeBilling.marketing,
      total: schema.franchiseeBilling.total,
    })
    .from(schema.franchiseeBilling)
    .where(periodBillingConditions(period, franchiseeIds))
    .for("update");
}

function exportRows(
  franchisees: readonly ActiveFranchisee[],
  billings: readonly PeriodBilling[],
): readonly ExportBillingRow[] {
  const billingByFranchisee = new Map(
    billings.map((billing) => [billing.franchiseeId, billing]),
  );
  return franchisees.map((franchisee) => {
    const billing = billingByFranchisee.get(franchisee.id);
    return {
      billingId: billing?.id ?? null,
      franchiseeId: franchisee.id,
      franchiseeName: franchisee.name,
      accountKeySnapshot: billing?.accountKeySnapshot ?? null,
      status: billing?.status ?? null,
      noRevenueReason: billing?.noRevenueReason ?? null,
      royalty: billing?.royalty ?? null,
      marketing: billing?.marketing ?? null,
      total: billing?.total ?? null,
    };
  });
}

async function readBrandContexts(
  database: ExportDatabase,
  period: FranchiseeBillingPeriod,
): Promise<readonly BrandExportContext[]> {
  const [brands, franchisees, billings] = await Promise.all([
    readBrands(database),
    readActiveFranchisees(database),
    readPeriodBillings(database, period),
  ]);
  return brands.map((brand) => ({
    brandId: brand.id,
    brandCode: brand.code,
    brandName: brand.name,
    rows: exportRows(
      franchisees.filter((item) => item.brandId === brand.id),
      billings,
    ),
  }));
}

async function readLockedBrand(
  database: ExportDatabase,
  brandId: string,
) {
  const [brand] = await database
    .select({
      id: schema.brand.id,
      code: schema.brand.code,
      name: schema.brand.nameHe,
    })
    .from(schema.brand)
    .where(
      and(
        eq(schema.brand.id, brandId),
        inArray(schema.brand.code, [...SUPPORTED_BRAND_CODES]),
        eq(schema.brand.isActive, true),
      ),
    )
    .limit(1)
    .for("share");
  return brand ?? null;
}

async function loadLockedBrandContext(
  database: ExportDatabase,
  input: HashavshevetExportInput,
): Promise<BrandExportContext | null> {
  const brand = await readLockedBrand(database, input.brandId);
  if (!brand) return null;
  const franchisees = await readLockedActiveFranchisees(database, brand.id);
  const ids = franchisees.map((franchisee) => franchisee.id);
  const billings = await readLockedPeriodBillings(database, input, ids);
  return {
    brandId: brand.id,
    brandCode: brand.code,
    brandName: brand.name,
    rows: exportRows(franchisees, billings),
  };
}

async function updateExportedRows(
  database: ExportDatabase,
  input: PersistExportInput,
): Promise<void> {
  if (input.billingIds.length === 0) return;
  const updated = await createUpdateExportedRowsQuery(
    database,
    input,
  ).returning({ id: schema.franchiseeBilling.id });
  if (updated.length !== input.billingIds.length) {
    throw new Error("Export rows changed during persistence");
  }
}

export function createUpdateExportedRowsQuery(
  database: Pick<ExportDatabase, "update">,
  input: PersistExportInput,
) {
  const exportedColumns = input.itemType === "royalty"
    ? {
        royaltyExportedAt: input.exportedAt,
        royaltyExportBatchId: input.batchId,
      }
    : {
        marketingExportedAt: input.exportedAt,
        marketingExportBatchId: input.batchId,
      };
  return database
    .update(schema.franchiseeBilling)
    .set(exportedColumns)
    .where(
      and(
        inArray(schema.franchiseeBilling.id, [...input.billingIds]),
        eq(schema.franchiseeBilling.status, "approved"),
      ),
    );
}

async function persistExport(
  database: ExportDatabase,
  input: PersistExportInput,
): Promise<void> {
  await database.insert(schema.franchiseeBillingExport).values({
    id: input.batchId,
    brandId: input.brandId,
    itemType: input.itemType,
    periodYear: input.year,
    periodMonth: input.month,
    exportedAt: input.exportedAt,
    exportedBy: input.exportedBy,
    rowCount: input.rowCount,
    blobUrl: input.blobUrl,
  });
  await updateExportedRows(database, input);
}

function exportStore(database: ExportDatabase): HashavshevetExportStore {
  return {
    loadBrandContextForUpdate: (input) =>
      loadLockedBrandContext(database, input),
    persistExport: (input) => persistExport(database, input),
  };
}

export async function createHashavshevetExportOperations(): Promise<
  HashavshevetExportOperations
> {
  const [{ database }, blob] = await Promise.all([
    import("@/db"),
    import("@vercel/blob"),
  ]);
  return {
    readBrandContexts: (period) => readBrandContexts(database, period),
    withTransaction: (work) =>
      database.transaction(
        (tx) => work(exportStore(tx)),
        { isolationLevel: "serializable" },
      ),
    storeFile: async ({ pathname, buffer }) => {
      const stored = await blob.put(pathname, buffer, {
        access: "public",
        addRandomSuffix: false,
        contentType: XLSX_MIME,
      });
      return { url: stored.url, pathname: stored.pathname };
    },
    deleteFile: (url) => blob.del(url),
  };
}
