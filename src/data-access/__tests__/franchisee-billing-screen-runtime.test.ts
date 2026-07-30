import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";

import {
  createDeleteBillingLedgerQuery,
  createPeriodRowsQuery,
  createReopenBillingQuery,
  createSourceReviewUpdateQuery,
} from "@/data-access/franchisee-billing-screen-runtime";
import type {
  PersistDifferenceResolutionInput,
  ReopenedBillingValues,
} from "@/data-access/franchisee-billing-screen";
import * as schema from "@/db/schema";

function reopenedBilling(): ReopenedBillingValues {
  return {
    billingId: "billing-1",
    franchiseeId: "franchisee-1",
    periodYear: 2026,
    periodMonth: 6,
    receipts: "236",
    tips: "0",
    includeTips: false,
    grossBase: "236",
    netBase: "200",
    tierRate: "4",
    discountRatePoints: "1",
    effectiveRate: "3",
    royaltyFull: "8",
    royalty: "6",
    discountValue: "2",
    marketing: "2",
    subtotal: "8",
    total: "9.44",
    sourceFileId: "source-1",
  };
}

function resolutionInput(): PersistDifferenceResolutionInput {
  const expectedMetadata = {
    documentType: "franchisee_royalty_revenue" as const,
    anomalies: [],
    approvedDifferences: [{
      franchiseeId: "franchisee-1",
      status: "approved" as const,
      differences: [{
        field: "receipts",
        approvedValue: "118",
        uploadedValue: 236,
      }],
    }],
    warnings: [],
    draftsWritten: 0,
  };
  return {
    sourceFileId: "source-1",
    franchiseeId: "franchisee-1",
    periodYear: 2026,
    periodMonth: 6,
    expectedMetadata,
    updatedMetadata: {
      ...expectedMetadata,
      approvedDifferences: [],
    },
    reopenedBilling: reopenedBilling(),
  };
}

describe("franchisee billing reopen SQL", () => {
  it("marks rows from the first upload stale against the second live upload", () => {
    const database = drizzle.mock({ schema });
    const query = createPeriodRowsQuery(
      database,
      { year: 2026, month: 6 },
      "source-2",
    ).toSQL();

    expect(query.sql).toContain('"source_file_id" is distinct from $1');
    expect(query.sql).toContain(
      'left join "uploaded_file" on "franchisee_billing"."source_file_id" = "uploaded_file"."id"',
    );
    expect(
      query.params.filter((parameter) => parameter === "source-2"),
    ).toHaveLength(2);
  });

  it("blocks every partial or complete Hashavshevet export marker", () => {
    const database = drizzle.mock({ schema });
    const query = createReopenBillingQuery(
      database,
      reopenedBilling(),
    ).toSQL();

    expect(query.sql).toContain('"royalty_exported_at" is null');
    expect(query.sql).toContain('"royalty_export_batch_id" is null');
    expect(query.sql).toContain('"marketing_exported_at" is null');
    expect(query.sql).toContain('"marketing_export_batch_id" is null');
    expect(query.params).toContain("approved");
  });

  it("deletes the approval ledger artifact by billing id", () => {
    const database = drizzle.mock({ schema });
    const query = createDeleteBillingLedgerQuery(
      database,
      "billing-1",
    ).toSQL();

    expect(query.sql).toContain('delete from "franchisee_deferral_ledger"');
    expect(query.sql).toContain('"billing_id" = $1');
    expect(query.params).toEqual(["billing-1"]);
  });

  it("updates source metadata only when the semantic JSON version still matches", () => {
    const database = drizzle.mock({ schema });
    const input = resolutionInput();
    const query = createSourceReviewUpdateQuery(
      database,
      input,
      false,
    ).toSQL();

    expect(query.sql).toContain('"uploaded_file"."metadata" =');
    expect(query.sql).toContain("::jsonb");
    expect(query.sql).toContain("select live_source.id");
    expect(query.sql).toContain("order by live_source.created_at desc");
    expect(query.params).toContain(JSON.stringify(input.expectedMetadata));
    expect(query.params).toContain("source-1");
  });
});
