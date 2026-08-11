import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";

import {
  createDeleteBillingLedgerQuery,
  createDiscountContextQuery,
  createNoRevenueReasonUpdateQuery,
  createPeriodRowsQuery,
  createReopenBillingQuery,
  createSourceReviewUpdateQuery,
  mapLatestSourceReviewsByBrand,
  resolveLiveSourceReview,
  selectLiveUnlinkedSources,
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
  it("loads discount inputs from the source row and live franchisee config", () => {
    const database = drizzle.mock({ schema });
    const query = createDiscountContextQuery(database, "billing-1").toSQL();

    expect(query.sql).toContain('"franchisee_billing"."receipts"');
    expect(query.sql).toContain('"franchisee_billing"."tips"');
    expect(query.sql).toContain('"franchisee_billing"."include_tips"');
    expect(query.sql).toContain('"franchisee"."royalty_tiers"');
    expect(query.sql).toContain('"franchisee"."royalty_tier_basis"');
    expect(query.sql).toContain('"franchisee"."marketing_fee_rate"');
    expect(query.sql).not.toContain('"franchisee_billing"."net_base"');
    expect(query.params).toEqual(["billing-1", 1]);
  });

  it("keeps the newest ordered source independently for every brand", () => {
    const sources = mapLatestSourceReviewsByBrand([
      {
        brandId: "brand-mina",
        id: "mina-new",
        createdAt: new Date("2026-08-06T10:00:00Z"),
        fileName: "מינה-מתוקן.xlsx",
        metadata: { version: 2 },
      },
      {
        brandId: "brand-mina",
        id: "mina-old",
        createdAt: new Date("2026-08-05T10:00:00Z"),
        fileName: "מינה.xlsx",
        metadata: { version: 1 },
      },
      {
        brandId: "brand-vini",
        id: "vini-live",
        createdAt: new Date("2026-08-05T11:00:00Z"),
        fileName: "ויני.xlsx",
        metadata: { version: 1 },
      },
    ]);

    expect([...sources]).toEqual([
      ["brand-mina", {
        id: "mina-new",
        fileName: "מינה-מתוקן.xlsx",
        metadata: { version: 2 },
      }],
      ["brand-vini", {
        id: "vini-live",
        fileName: "ויני.xlsx",
        metadata: { version: 1 },
      }],
    ]);
  });

  it("resolves a requested source only against the franchisee brand", () => {
    const sources = new Map([
      ["brand-vini", {
        id: "vini-new",
        fileName: "ויני-מתוקן.xlsx",
        metadata: {},
      }],
      ["brand-mina", {
        id: "mina-live",
        fileName: "מינה.xlsx",
        metadata: {},
      }],
    ]);

    expect(resolveLiveSourceReview(sources, "brand-mina", "mina-live"))
      .toMatchObject({ id: "mina-live" });
    expect(resolveLiveSourceReview(sources, "brand-vini", "vini-old"))
      .toBeNull();
  });

  it("compares every row with the live source of its own brand using the exact SQL", () => {
    const database = drizzle.mock({ schema });
    const query = createPeriodRowsQuery(
      database,
      { year: 2026, month: 6 },
      new Map([
        ["brand-vini", {
          id: "source-vini",
          fileName: "ויני.xlsx",
          metadata: {},
        }],
        ["brand-mina", {
          id: "source-mina",
          fileName: "מינה.xlsx",
          metadata: {},
        }],
      ]),
    ).toSQL();

    expect(query.sql).toBe(
      "select \"franchisee_billing\".\"id\", \"franchisee_billing\".\"franchisee_id\", \"franchisee\".\"name\", \"franchisee_billing\".\"period_year\", \"franchisee_billing\".\"period_month\", \"franchisee_billing\".\"gross_base\", \"franchisee_billing\".\"net_base\", \"franchisee_billing\".\"tier_rate\", \"franchisee_billing\".\"discount_rate_points\", \"franchisee_billing\".\"discount_value\", \"franchisee_billing\".\"royalty\", \"franchisee_billing\".\"marketing\", \"franchisee_billing\".\"subtotal\", \"franchisee_billing\".\"total\", \"franchisee_billing\".\"no_revenue_reason\", coalesce((\n      select sum(\"franchisee_deferral_ledger\".\"amount\")\n      from \"franchisee_deferral_ledger\"\n      where \"franchisee_deferral_ledger\".\"franchisee_id\" = \"franchisee_billing\".\"franchisee_id\"\n    ), 0)::text, \"franchisee_billing\".\"source_file_id\", \"uploaded_file\".\"original_file_name\", \"franchisee_billing\".\"source_file_id\" is distinct from case \"franchisee\".\"brand_id\" when $1 then $2 when $3 then $4 else null end, \"franchisee_billing\".\"source_file_id\" is distinct from case \"franchisee\".\"brand_id\" when $5 then $6 when $7 then $8 else null end, \"franchisee_billing\".\"status\", \"franchisee\".\"owners\" from \"franchisee_billing\" inner join \"franchisee\" on \"franchisee_billing\".\"franchisee_id\" = \"franchisee\".\"id\" left join \"uploaded_file\" on \"franchisee_billing\".\"source_file_id\" = \"uploaded_file\".\"id\" where (\"franchisee_billing\".\"period_year\" = $9 and \"franchisee_billing\".\"period_month\" = $10) order by \"franchisee\".\"name\" asc",
    );
    expect(query.params).toEqual([
      "brand-vini",
      "source-vini",
      "brand-mina",
      "source-mina",
      "brand-vini",
      "source-vini",
      "brand-mina",
      "source-mina",
      2026,
      6,
    ]);
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

  it("guards a no-revenue reason with draft status and all zero amounts", () => {
    const database = drizzle.mock({ schema });
    const query = createNoRevenueReasonUpdateQuery(database, {
      billingId: "billing-1",
      noRevenueReason: "הסניף היה סגור",
    }).toSQL();

    expect(query.sql).toContain('"status" =');
    expect(query.sql).toContain('"royalty" =');
    expect(query.sql).toContain('"marketing" =');
    expect(query.sql).toContain('"total" =');
    expect(query.params).toEqual([
      "הסניף היה סגור",
      "billing-1",
      "draft",
      "0",
      "0",
      "0",
    ]);
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

  it("updates source metadata only when it is still live for the franchisee brand", () => {
    const database = drizzle.mock({ schema });
    const input = resolutionInput();
    const query = createSourceReviewUpdateQuery(
      database,
      input,
      false,
    ).toSQL();

    expect(query.sql).toBe(
      "update \"uploaded_file\" set \"metadata\" = $1, \"processing_status\" = $2 where (\"uploaded_file\".\"id\" = $3 and \"uploaded_file\".\"metadata\" = $4::jsonb and \"uploaded_file\".\"id\" = (\n    select live_source.id\n    from \"uploaded_file\" as live_source\n    inner join \"franchisee_billing\" as live_billing\n      on live_billing.source_file_id = live_source.id\n    inner join \"franchisee\" as live_franchisee\n      on live_franchisee.id = live_billing.franchisee_id\n    where live_source.period_start_date = $5\n      and live_source.metadata->>'documentType' = $6\n      and live_billing.period_year = $7\n      and live_billing.period_month = $8\n      and live_franchisee.brand_id = (\n        select requested_franchisee.brand_id\n        from \"franchisee\" as requested_franchisee\n        where requested_franchisee.id = $9\n      )\n    order by live_source.created_at desc, live_source.id desc\n    limit 1\n  ))",
    );
    expect(query.params).toEqual([
      JSON.stringify(input.updatedMetadata),
      "auto_approved",
      "source-1",
      JSON.stringify(input.expectedMetadata),
      "2026-06-01",
      "franchisee_royalty_revenue",
      2026,
      6,
      "franchisee-1",
    ]);
  });
});

describe("selectLiveUnlinkedSources", () => {
  const unlinked = (
    id: string,
    brandId: string | null,
    createdAt: string,
  ) => ({
    id,
    brandId,
    createdAt: new Date(createdAt),
    fileName: `${id}.xlsx`,
    metadata: { id, anomalies: [{ code: "unmatched_branch" }] },
  });
  const linked = (id: string, brandId: string, createdAt: string) => ({
    id, brandId, createdAt: new Date(createdAt), fileName: `${id}.xlsx`, metadata: { id },
  });

  it("keeps only the newest failed attempt per brand", () => {
    // Reut re-uploaded the same month three times; only the last one is live.
    const live = selectLiveUnlinkedSources(
      [
        unlinked("king-3", "brand-king", "2026-08-06T14:18:00Z"),
        unlinked("king-2", "brand-king", "2026-08-05T07:57:00Z"),
        unlinked("king-1", "brand-king", "2026-08-05T07:49:00Z"),
      ],
      [],
    );

    expect(live.map((source) => source.id)).toEqual(["king-3"]);
  });

  it("keeps one live attempt per brand", () => {
    const live = selectLiveUnlinkedSources(
      [
        unlinked("king", "brand-king", "2026-08-05T07:57:00Z"),
        unlinked("vini", "brand-vini", "2026-08-05T07:54:00Z"),
        unlinked("mina", "brand-mina", "2026-08-05T07:49:00Z"),
      ],
      [],
    );

    expect(live.map((source) => source.id)).toEqual(["king", "vini", "mina"]);
  });

  it("drops an attempt that a later successful upload replaced", () => {
    const live = selectLiveUnlinkedSources(
      [unlinked("king-old", "brand-king", "2026-08-06T14:18:00Z")],
      [linked("king-new", "brand-king", "2026-08-07T04:12:00Z")],
    );

    expect(live).toEqual([]);
  });

  it("keeps an attempt newer than the last successful upload", () => {
    // A wholly blocked re-upload still has to surface its anomalies, even
    // though an older file is the one holding the billing rows.
    const live = selectLiveUnlinkedSources(
      [unlinked("king-new", "brand-king", "2026-08-08T09:00:00Z")],
      [linked("king-old", "brand-king", "2026-08-07T04:12:00Z")],
    );

    expect(live.map((source) => source.id)).toEqual(["king-new"]);
  });

  it("supersedes unresolvable brands within their own bucket", () => {
    const live = selectLiveUnlinkedSources(
      [
        unlinked("nameless-2", null, "2026-08-06T14:18:00Z"),
        unlinked("nameless-1", null, "2026-08-05T07:49:00Z"),
      ],
      [linked("king", "brand-king", "2026-08-07T04:12:00Z")],
    );

    expect(live.map((source) => source.id)).toEqual(["nameless-2"]);
  });

  it("drops the brandId and createdAt it filtered on", () => {
    const [live] = selectLiveUnlinkedSources(
      [unlinked("king", "brand-king", "2026-08-06T14:18:00Z")],
      [],
    );

    expect(live).toEqual({
      id: "king",
      fileName: "king.xlsx",
      metadata: { id: "king", anomalies: [{ code: "unmatched_branch" }] },
    });
  });
});

describe("selectLiveUnlinkedSources — superseded clean uploads", () => {
  const clean = (id: string, createdAt: string) => ({
    id,
    brandId: null, // nothing named a franchisee, so no brand can be derived
    createdAt: new Date(createdAt),
    fileName: `${id}.xlsx`,
    metadata: { anomalies: [], warnings: [], approvedDifferences: [] },
  });
  const linked = (id: string, brandId: string, createdAt: string) => ({
    id, brandId, createdAt: new Date(createdAt), fileName: `${id}.xlsx`, metadata: { id },
  });

  it("drops a clean upload once the month has a linked file", () => {
    // Re-uploading a clean month leaves the previous attempt unlinked with no
    // findings — nothing to say, and no franchisee to place it by brand.
    const live = selectLiveUnlinkedSources(
      [clean("mina-2", "2026-08-11T09:01:00Z"), clean("mina-1", "2026-08-11T08:58:00Z")],
      [linked("mina-3", "brand-mina", "2026-08-11T09:06:00Z")],
    );

    expect(live).toEqual([]);
  });

  it("keeps a clean upload when it is the only evidence of the month", () => {
    const live = selectLiveUnlinkedSources([clean("only", "2026-08-11T09:01:00Z")], []);

    expect(live.map((source) => source.id)).toEqual(["only"]);
  });

  it("never drops an upload that still has findings", () => {
    const withFindings = {
      ...clean("noisy", "2026-08-11T09:01:00Z"),
      metadata: { anomalies: [], warnings: ["שורה חריגה"], approvedDifferences: [] },
    };

    const live = selectLiveUnlinkedSources(
      [withFindings],
      [linked("other", "brand-mina", "2026-08-11T09:06:00Z")],
    );

    expect(live.map((source) => source.id)).toEqual(["noisy"]);
  });
});
