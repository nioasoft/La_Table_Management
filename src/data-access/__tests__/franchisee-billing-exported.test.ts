import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import {
  billingExported,
  billingNotExported,
  isBillingExported,
  type BillingExportMarkers,
} from "@/data-access/franchisee-billing-exported";

const NONE: BillingExportMarkers = {
  royaltyExportedAt: null,
  royaltyExportBatchId: null,
  marketingExportedAt: null,
  marketingExportBatchId: null,
};

describe("isBillingExported", () => {
  it("is false for a row that never left", () => {
    expect(isBillingExported(NONE)).toBe(false);
    expect(isBillingExported(null)).toBe(false);
    expect(isBillingExported(undefined)).toBe(false);
  });

  it.each([
    ["an Excel royalty batch", { royaltyExportBatchId: "batch-1" }],
    ["an Excel marketing batch", { marketingExportBatchId: "batch-2" }],
    // Approved through the H-Connect API: stamped, but no Excel batch row.
    ["an API-approved royalty", { royaltyExportedAt: new Date(2026, 9, 1) }],
    ["an API-approved marketing", { marketingExportedAt: new Date(2026, 9, 1) }],
  ])("is true for %s", (_label, marker) => {
    expect(isBillingExported({ ...NONE, ...marker })).toBe(true);
  });
});

describe("export marker SQL", () => {
  const database = drizzle.mock({ schema });
  const sqlOf = (condition: ReturnType<typeof billingNotExported>) =>
    database
      .select({ id: schema.franchiseeBilling.id })
      .from(schema.franchiseeBilling)
      .where(condition)
      .toSQL().sql;

  it("treats a row as not exported only when all four markers are empty", () => {
    const text = sqlOf(billingNotExported());

    expect(text).toContain('"royalty_exported_at" is null');
    expect(text).toContain('"royalty_export_batch_id" is null');
    expect(text).toContain('"marketing_exported_at" is null');
    expect(text).toContain('"marketing_export_batch_id" is null');
  });

  it("treats any one marker as exported", () => {
    const text = sqlOf(billingExported());

    expect(text).toContain('"royalty_exported_at" is not null');
    expect(text).toContain('"royalty_export_batch_id" is not null');
    expect(text).toContain('"marketing_exported_at" is not null');
    expect(text).toContain('"marketing_export_batch_id" is not null');
    expect(text).toMatch(/ or /);
  });
});
