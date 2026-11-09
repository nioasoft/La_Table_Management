import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";

import type { PersistExportInput } from "@/app/api/franchisee-billing/hashavshevet-export/route";
import { createMarkApiExportedQuery, createUpdateExportedRowsQuery } from "@/data-access/franchisee-billing-export";
import * as schema from "@/db/schema";

function persistInput(
  itemType: PersistExportInput["itemType"],
): PersistExportInput {
  return {
    year: 2026,
    month: 6,
    brandId: "brand-1",
    itemType,
    batchId: "batch-1",
    exportedAt: new Date("2026-06-30T09:00:00.000Z"),
    exportedBy: "user-1",
    rowCount: 2,
    blobUrl: "https://blob.example/export.xlsx",
    billingIds: ["billing-1", "billing-2"],
  };
}

describe("franchisee billing export SQL", () => {
  it("updates royalty tracking without touching marketing tracking", () => {
    const database = drizzle.mock({ schema });
    const query = createUpdateExportedRowsQuery(
      database,
      persistInput("royalty"),
    ).toSQL();

    expect(query.sql).toBe(
      'update "franchisee_billing" set "royalty_exported_at" = $1, "royalty_export_batch_id" = $2 where ("franchisee_billing"."id" in ($3, $4) and "franchisee_billing"."status" = $5)',
    );
    expect(query.params).toEqual([
      "2026-06-30T09:00:00.000Z",
      "batch-1",
      "billing-1",
      "billing-2",
      "approved",
    ]);
  });

  it("updates marketing tracking without touching royalty tracking", () => {
    const database = drizzle.mock({ schema });
    const query = createUpdateExportedRowsQuery(
      database,
      persistInput("marketing"),
    ).toSQL();

    expect(query.sql).toBe(
      'update "franchisee_billing" set "marketing_exported_at" = $1, "marketing_export_batch_id" = $2 where ("franchisee_billing"."id" in ($3, $4) and "franchisee_billing"."status" = $5)',
    );
    expect(query.params).toEqual([
      "2026-06-30T09:00:00.000Z",
      "batch-1",
      "billing-1",
      "billing-2",
      "approved",
    ]);
  });
});

describe("API send bookkeeping SQL (ruling R27)", () => {
  const input = (itemType: "royalty" | "marketing") => ({
    itemType,
    year: 2026,
    month: 6,
    franchiseeIds: ["f-1", "f-2"],
    exportedAt: new Date("2026-07-02T09:00:00.000Z"),
  });

  it("stamps royalty_exported_at on the period's approved rows, with no export batch", () => {
    const query = createMarkApiExportedQuery(drizzle.mock({ schema }), input("royalty")).toSQL();
    expect(query.sql).toBe(
      'update "franchisee_billing" set "royalty_exported_at" = $1 where ("franchisee_billing"."franchisee_id" in ($2, $3) and "franchisee_billing"."period_year" = $4 and "franchisee_billing"."period_month" = $5 and "franchisee_billing"."status" = $6)',
    );
    expect(query.params).toEqual(["2026-07-02T09:00:00.000Z", "f-1", "f-2", 2026, 6, "approved"]);
  });

  it("stamps marketing_exported_at only, for marketing", () => {
    const { sql } = createMarkApiExportedQuery(drizzle.mock({ schema }), input("marketing")).toSQL();
    expect(sql).toMatch(/^update "franchisee_billing" set "marketing_exported_at" = \$1 where/);
    expect(sql).not.toContain("royalty");
    expect(sql).not.toContain("batch");
  });
});
