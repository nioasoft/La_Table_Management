import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { database } from "@/db";
import * as schema from "@/db/schema";
import type { FranchiseeBillingPeriod } from "@/schemas/franchisee-billing-screen";
import type {
  FranchiseeBillingReportPayload,
  FranchiseeBillingReportQuery,
} from "@/schemas/franchisee-billing-reports";

type ReportDatabase = NodePgDatabase<typeof schema>;

const identitySelection = {
  franchiseeId: schema.franchisee.id,
  franchiseeName: schema.franchisee.name,
  brandName: schema.brand.nameHe,
};

function selectedMonth(period: FranchiseeBillingPeriod) {
  return and(
    eq(schema.franchiseeBilling.periodYear, period.year),
    eq(schema.franchiseeBilling.periodMonth, period.month),
  );
}

function throughSelectedMonth(period: FranchiseeBillingPeriod) {
  return or(
    lt(schema.franchiseeBilling.periodYear, period.year),
    and(
      eq(schema.franchiseeBilling.periodYear, period.year),
      sql`${schema.franchiseeBilling.periodMonth} <= ${period.month}`,
    ),
  );
}

export function createRoyaltyReportQuery(
  reportDatabase: ReportDatabase,
  period: FranchiseeBillingPeriod,
) {
  return reportDatabase
    .select({
      ...identitySelection,
      royalty: schema.franchiseeBilling.royalty,
      tierRate: schema.franchiseeBilling.tierRate,
      effectiveRate: schema.franchiseeBilling.effectiveRate,
      discountValue: schema.franchiseeBilling.discountValue,
      status: schema.franchiseeBilling.status,
    })
    .from(schema.franchiseeBilling)
    .innerJoin(
      schema.franchisee,
      eq(schema.franchiseeBilling.franchiseeId, schema.franchisee.id),
    )
    .innerJoin(schema.brand, eq(schema.franchisee.brandId, schema.brand.id))
    .where(
      and(
        selectedMonth(period),
        ne(schema.franchiseeBilling.royalty, "0"),
      ),
    )
    .orderBy(asc(schema.brand.nameHe), asc(schema.franchisee.name));
}

export function createTurnoverReportQuery(
  reportDatabase: ReportDatabase,
  period: FranchiseeBillingPeriod,
) {
  return reportDatabase
    .select({
      ...identitySelection,
      grossBase: schema.franchiseeBilling.grossBase,
      netBase: schema.franchiseeBilling.netBase,
      status: schema.franchiseeBilling.status,
    })
    .from(schema.franchiseeBilling)
    .innerJoin(
      schema.franchisee,
      eq(schema.franchiseeBilling.franchiseeId, schema.franchisee.id),
    )
    .innerJoin(schema.brand, eq(schema.franchisee.brandId, schema.brand.id))
    .where(selectedMonth(period))
    .orderBy(asc(schema.brand.nameHe), asc(schema.franchisee.name));
}

export function createCollectionReportQuery(
  reportDatabase: ReportDatabase,
  period: FranchiseeBillingPeriod,
) {
  return reportDatabase
    .select({
      ...identitySelection,
      royaltyCollected: sql<string>`coalesce(sum(
        case
          when ${schema.franchiseeBilling.royaltyExportedAt} is not null
          then ${schema.franchiseeBilling.royalty}
          else 0
        end
      ), 0)`,
      marketingCollected: sql<string>`coalesce(sum(
        case
          when ${schema.franchiseeBilling.marketingExportedAt} is not null
          then ${schema.franchiseeBilling.marketing}
          else 0
        end
      ), 0)`,
    })
    .from(schema.franchiseeBilling)
    .innerJoin(
      schema.franchisee,
      eq(schema.franchiseeBilling.franchiseeId, schema.franchisee.id),
    )
    .innerJoin(schema.brand, eq(schema.franchisee.brandId, schema.brand.id))
    .where(
      and(
        throughSelectedMonth(period),
        or(
          isNotNull(schema.franchiseeBilling.royaltyExportedAt),
          isNotNull(schema.franchiseeBilling.marketingExportedAt),
        ),
      ),
    )
    .groupBy(
      schema.franchisee.id,
      schema.franchisee.name,
      schema.brand.nameHe,
    )
    .orderBy(asc(schema.brand.nameHe), asc(schema.franchisee.name));
}

function firstDayAfter(period: FranchiseeBillingPeriod) {
  if (period.month === 12) {
    return { year: period.year + 1, month: 1 };
  }
  return { year: period.year, month: period.month + 1 };
}

export function createDiscountReportQuery(
  reportDatabase: ReportDatabase,
  period: FranchiseeBillingPeriod,
) {
  const nextPeriod = firstDayAfter(period);
  return reportDatabase
    .select({
      ...identitySelection,
      discountValue:
        sql<string>`coalesce(sum(${schema.franchiseeDeferralLedger.amount}), 0)`,
    })
    .from(schema.franchiseeDeferralLedger)
    .innerJoin(
      schema.franchisee,
      eq(
        schema.franchiseeDeferralLedger.franchiseeId,
        schema.franchisee.id,
      ),
    )
    .innerJoin(schema.brand, eq(schema.franchisee.brandId, schema.brand.id))
    .leftJoin(
      schema.franchiseeBilling,
      eq(
        schema.franchiseeDeferralLedger.billingId,
        schema.franchiseeBilling.id,
      ),
    )
    .where(
      or(
        and(
          isNotNull(schema.franchiseeDeferralLedger.billingId),
          throughSelectedMonth(period),
        ),
        and(
          isNull(schema.franchiseeDeferralLedger.billingId),
          sql`${schema.franchiseeDeferralLedger.createdAt}
            < make_date(${nextPeriod.year}, ${nextPeriod.month}, 1)`,
        ),
      ),
    )
    .groupBy(
      schema.franchisee.id,
      schema.franchisee.name,
      schema.brand.nameHe,
    )
    .orderBy(asc(schema.brand.nameHe), asc(schema.franchisee.name));
}

export async function loadFranchiseeBillingReport(
  input: FranchiseeBillingReportQuery,
  reportDatabase: ReportDatabase = database,
): Promise<FranchiseeBillingReportPayload> {
  const period = { year: input.year, month: input.month };
  if (input.reportType === "royalties") {
    const rows = await createRoyaltyReportQuery(reportDatabase, period);
    return { reportType: input.reportType, period, rows };
  }
  if (input.reportType === "turnover") {
    const rows = await createTurnoverReportQuery(reportDatabase, period);
    return { reportType: input.reportType, period, rows };
  }
  if (input.reportType === "collection") {
    const rows = await createCollectionReportQuery(reportDatabase, period);
    return { reportType: input.reportType, period, rows };
  }
  const rows = await createDiscountReportQuery(reportDatabase, period);
  return { reportType: input.reportType, period, rows };
}
