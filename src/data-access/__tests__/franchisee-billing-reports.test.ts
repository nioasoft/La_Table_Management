import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";

import {
  createCollectionReportQuery,
  createDiscountReportQuery,
  createRoyaltyReportQuery,
  createTurnoverReportQuery,
} from "@/data-access/franchisee-billing-reports";
import * as schema from "@/db/schema";

const period = { year: 2026, month: 6 } as const;

function compactSql(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function expectParams(
  actual: readonly unknown[],
  expected: readonly unknown[],
): void {
  expect(actual.length).toBe(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index]).toBe(value);
  });
}

describe("franchisee billing report SQL", () => {
  it("reads non-zero royalties for the selected month", () => {
    const database = drizzle.mock({ schema });
    const query = createRoyaltyReportQuery(database, period).toSQL();

    expect(compactSql(query.sql)).toBe(
      'select "franchisee"."id", "franchisee"."name", "brand"."name_he", "franchisee_billing"."royalty", "franchisee_billing"."tier_rate", "franchisee_billing"."effective_rate", "franchisee_billing"."discount_value", "franchisee_billing"."status" from "franchisee_billing" inner join "franchisee" on "franchisee_billing"."franchisee_id" = "franchisee"."id" inner join "brand" on "franchisee"."brand_id" = "brand"."id" where (("franchisee_billing"."period_year" = $1 and "franchisee_billing"."period_month" = $2) and "franchisee_billing"."royalty" <> $3) order by "brand"."name_he" asc, "franchisee"."name" asc',
    );
    expectParams(query.params, [2026, 6, "0"]);
  });

  it("reads both turnover bases for every billing in the selected month", () => {
    const database = drizzle.mock({ schema });
    const query = createTurnoverReportQuery(database, period).toSQL();

    expect(compactSql(query.sql)).toBe(
      'select "franchisee"."id", "franchisee"."name", "brand"."name_he", "franchisee_billing"."gross_base", "franchisee_billing"."net_base", "franchisee_billing"."status" from "franchisee_billing" inner join "franchisee" on "franchisee_billing"."franchisee_id" = "franchisee"."id" inner join "brand" on "franchisee"."brand_id" = "brand"."id" where ("franchisee_billing"."period_year" = $1 and "franchisee_billing"."period_month" = $2) order by "brand"."name_he" asc, "franchisee"."name" asc',
    );
    expectParams(query.params, [2026, 6]);
  });

  it("counts royalty and marketing collection by their own export timestamps", () => {
    const database = drizzle.mock({ schema });
    const query = createCollectionReportQuery(database, period).toSQL();

    expect(compactSql(query.sql)).toBe(
      'select "franchisee"."id", "franchisee"."name", "brand"."name_he", coalesce(sum( case when "franchisee_billing"."royalty_exported_at" is not null then "franchisee_billing"."royalty" else 0 end ), 0), coalesce(sum( case when "franchisee_billing"."marketing_exported_at" is not null then "franchisee_billing"."marketing" else 0 end ), 0) from "franchisee_billing" inner join "franchisee" on "franchisee_billing"."franchisee_id" = "franchisee"."id" inner join "brand" on "franchisee"."brand_id" = "brand"."id" where (("franchisee_billing"."period_year" < $1 or ("franchisee_billing"."period_year" = $2 and "franchisee_billing"."period_month" <= $3)) and ("franchisee_billing"."royalty_exported_at" is not null or "franchisee_billing"."marketing_exported_at" is not null)) group by "franchisee"."id", "franchisee"."name", "brand"."name_he" order by "brand"."name_he" asc, "franchisee"."name" asc',
    );
    expectParams(query.params, [2026, 2026, 6]);
  });

  it("sums stored ledger amounts without recalculating from rates or bases", () => {
    const database = drizzle.mock({ schema });
    const query = createDiscountReportQuery(database, period).toSQL();

    expect(compactSql(query.sql)).toBe(
      'select "franchisee"."id", "franchisee"."name", "brand"."name_he", coalesce(sum("franchisee_deferral_ledger"."amount"), 0) from "franchisee_deferral_ledger" inner join "franchisee" on "franchisee_deferral_ledger"."franchisee_id" = "franchisee"."id" inner join "brand" on "franchisee"."brand_id" = "brand"."id" left join "franchisee_billing" on "franchisee_deferral_ledger"."billing_id" = "franchisee_billing"."id" where (("franchisee_deferral_ledger"."billing_id" is not null and ("franchisee_billing"."period_year" < $1 or ("franchisee_billing"."period_year" = $2 and "franchisee_billing"."period_month" <= $3))) or ("franchisee_deferral_ledger"."billing_id" is null and "franchisee_deferral_ledger"."created_at" < make_date($4, $5, 1))) group by "franchisee"."id", "franchisee"."name", "brand"."name_he" order by "brand"."name_he" asc, "franchisee"."name" asc',
    );
    expectParams(query.params, [2026, 2026, 6, 2026, 7]);
  });
});
