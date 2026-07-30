import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type {
  BillingDiscountContext,
  BillingScreenOperations,
  BillingScreenRow,
  PersistDifferenceResolutionInput,
  PersistDiscountInput,
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
      source: {
        id: "source-1",
        fileName: "יוני.xlsx",
        metadata: {
          documentType: "franchisee_royalty_revenue",
          anomalies: [],
          approvedDifferences: [],
          warnings: [],
          draftsWritten: 1,
        },
      },
    };
  }

  async readDiscountContext(): Promise<BillingDiscountContext> {
    return {
      id: this.row.id,
      periodYear: this.row.periodYear,
      periodMonth: this.row.periodMonth,
      tierRate: this.row.tierRate,
      netBase: this.row.netBase,
      royaltyFull: "4",
      marketing: this.row.marketing,
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

  async readDifferenceContext(): Promise<null> {
    return null;
  }

  async persistDifferenceResolution(
    _input: PersistDifferenceResolutionInput,
  ): Promise<"success"> {
    return "success";
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
});
