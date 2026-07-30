import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";

import type { PersistExportInput } from "@/app/api/franchisee-billing/hashavshevet-export/route";
import { createUpdateExportedRowsQuery } from "@/data-access/franchisee-billing-export";
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
