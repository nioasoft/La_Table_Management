import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type {
  BillingDiscountContext,
  BillingNoRevenueContext,
  BillingScreenOperations,
  BillingScreenRow,
  PersistDifferenceResolutionInput,
  PersistDiscountInput,
  PersistNoRevenueReasonInput,
} from "@/data-access/franchisee-billing-screen";

vi.mock("@/lib/api-middleware", () => ({
  requireAdminOrSuperUser: vi.fn(async () => ({
    session: { id: "session-1" },
    user: {
      id: "user-1",
      email: "admin@example.com",
      role: "admin",
      status: "active",
    },
  })),
  isAuthError: vi.fn(() => false),
}));

import {
  handleGetFranchiseeBilling,
  handlePatchFranchiseeBilling,
} from "@/app/api/franchisee-billing/route";

function billingRow(
  overrides: Partial<BillingScreenRow> = {},
): BillingScreenRow {
  return {
    id: "billing-1",
    franchiseeId: "franchisee-1",
    franchiseeName: "ויני יהוד",
    brandName: "ויני",
    periodYear: 2026,
    periodMonth: 6,
    grossBase: "118",
    netBase: "100",
    tierRate: "4",
    discountRatePoints: "0",
    discountValue: "0",
    royalty: "4",
    marketing: "1",
    subtotal: "5",
    total: "5.9",
    noRevenueReason: null,
    deferralBalance: "0",
    sourceFileId: "source-1",
    sourceFileName: "יוני.xlsx",
    isStaleSource: false,
    isApprovalBlocked: false,
    status: "draft",
    ...overrides,
  };
}

class RouteMemoryOperations implements BillingScreenOperations {
  row = billingRow();

  async readPeriodSnapshot() {
    return {
      rows: [this.row],
      sourcesByBrand: new Map([["brand-vini", {
        id: "source-1",
        fileName: "יוני.xlsx",
        metadata: {
          documentType: "franchisee_royalty_revenue",
          anomalies: [],
          approvedDifferences: [],
          warnings: [],
          draftsWritten: 1,
        },
      }]]),
      unlinkedSources: [],
    };
  }

  async readDiscountContext(): Promise<BillingDiscountContext> {
    return {
      id: this.row.id,
      periodYear: this.row.periodYear,
      periodMonth: this.row.periodMonth,
      receipts: "118",
      tips: "0",
      includeTips: false,
      tiers: [{ upTo: null, rate: 4 }],
      tierBasis: "gross",
      marketingRate: "1",
      status: this.row.status,
    };
  }

  async readVatRate(): Promise<number> {
    return 0.18;
  }

  async persistDiscount(input: PersistDiscountInput): Promise<boolean> {
    this.row = {
      ...this.row,
      discountRatePoints: input.discountRatePoints,
      discountValue: input.discountValue,
      royalty: input.royalty,
      subtotal: input.subtotal,
      total: input.total,
    };
    return true;
  }

  async readNoRevenueContext(): Promise<BillingNoRevenueContext> {
    return {
      id: this.row.id,
      status: this.row.status,
      royalty: this.row.royalty,
      marketing: this.row.marketing,
      total: this.row.total,
    };
  }

  async persistNoRevenueReason(
    input: PersistNoRevenueReasonInput,
  ): Promise<boolean> {
    this.row = { ...this.row, noRevenueReason: input.noRevenueReason };
    return true;
  }

  async readDifferenceContext(): Promise<null> {
    return null;
  }

  async persistDifferenceResolution(
    _input: PersistDifferenceResolutionInput,
  ): Promise<"success"> {
    return "success";
  }

  async discardSourceFile(): Promise<"success"> {
    return "success";
  }

  async readBillableFranchisees() {
    return [{ id: "franchisee-1", name: "ויני יהוד", brandId: "brand-vini" }];
  }
}

function getRequest(): NextRequest {
  return new NextRequest(
    "http://localhost/api/franchisee-billing?year=2026&month=6",
  );
}

function patchRequest(discountRatePoints: number): NextRequest {
  return new NextRequest("http://localhost/api/franchisee-billing", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "update_discount",
      billingId: "billing-1",
      discountRatePoints,
    }),
  });
}

function noRevenueRequest(noRevenueReason: string): NextRequest {
  return new NextRequest("http://localhost/api/franchisee-billing", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "update_no_revenue_reason",
      billingId: "billing-1",
      noRevenueReason,
    }),
  });
}

describe("franchisee billing route with injected database operations", () => {
  it("persists a typed discount and returns it after a full route reload", async () => {
    const operations = new RouteMemoryOperations();

    const patchResponse = await handlePatchFranchiseeBilling(
      patchRequest(1.5),
      operations,
    );
    const reloadResponse = await handleGetFranchiseeBilling(
      getRequest(),
      operations,
    );
    const reloadedBody = await reloadResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(reloadedBody.data.rows[0]).toMatchObject({
      discountRatePoints: "1.5",
      discountValue: "1.5",
      royalty: "2.5",
      subtotal: "3.5",
      total: "4.13",
    });
  });

  it("persists a manual no-revenue reason and returns it after reload", async () => {
    const operations = new RouteMemoryOperations();
    operations.row = billingRow({
      royalty: "0",
      marketing: "0",
      subtotal: "0",
      total: "0",
    });

    const patchResponse = await handlePatchFranchiseeBilling(
      noRevenueRequest("הסניף היה סגור"),
      operations,
    );
    const reloadResponse = await handleGetFranchiseeBilling(
      getRequest(),
      operations,
    );
    const reloadedBody = await reloadResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(reloadedBody.data.rows[0].noRevenueReason).toBe(
      "הסניף היה סגור",
    );
  });
});
