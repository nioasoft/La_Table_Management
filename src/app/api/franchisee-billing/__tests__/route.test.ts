import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  loadScreen,
  resolveDifference,
  updateDiscount,
} = vi.hoisted(() => ({
  loadScreen: vi.fn(),
  resolveDifference: vi.fn(),
  updateDiscount: vi.fn(),
}));

vi.mock("@/lib/api-middleware", () => ({
  requireAdminOrSuperUser: vi.fn(async () => ({
    session: { id: "session-1" },
    user: {
      id: "user-1",
      email: "admin@example.com",
      name: "מנהלת",
      role: "admin",
      status: "active",
      isAdmin: true,
    },
  })),
  isAuthError: vi.fn(() => false),
}));

vi.mock("@/data-access/franchisee-billing-screen", () => ({
  loadFranchiseeBillingScreen: loadScreen,
  resolveApprovedBillingDifference: resolveDifference,
  updateBillingDiscount: updateDiscount,
}));

import { GET, PATCH } from "@/app/api/franchisee-billing/route";

function patchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/franchisee-billing", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/franchisee-billing", () => {
  beforeEach(() => {
    loadScreen.mockReset();
    resolveDifference.mockReset();
    updateDiscount.mockReset();
  });

  it("rejects an invalid billing month in Hebrew", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/franchisee-billing?year=2026&month=13",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "חודש החיוב אינו תקין",
    });
    expect(loadScreen).not.toHaveBeenCalled();
  });

  it("returns the persisted screen projection for a valid period", async () => {
    loadScreen.mockResolvedValue({
      period: { year: 2026, month: 6 },
      sourceFile: null,
      rows: [],
      anomalies: [],
      approvedDifferences: [],
      warnings: [],
    });

    const response = await GET(
      new NextRequest(
        "http://localhost/api/franchisee-billing?year=2026&month=6",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        period: { year: 2026, month: 6 },
        rows: [],
      },
    });
  });
});

describe("PATCH /api/franchisee-billing", () => {
  it("validates discount precision before calling the data layer", async () => {
    const response = await PATCH(
      patchRequest({
        action: "update_discount",
        billingId: "billing-1",
        discountRatePoints: 1.001,
      }),
    );

    expect(response.status).toBe(400);
    expect(updateDiscount).not.toHaveBeenCalled();
  });

  it("maps an approved-row edit conflict to HTTP 409", async () => {
    updateDiscount.mockResolvedValue({
      success: false,
      code: "approved",
      error: "שורה מאושרת אינה ניתנת לעריכה",
    });

    const response = await PATCH(
      patchRequest({
        action: "update_discount",
        billingId: "billing-1",
        discountRatePoints: 1,
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "שורה מאושרת אינה ניתנת לעריכה",
    });
  });

  it("resolves the explicit keep-approved choice", async () => {
    resolveDifference.mockResolvedValue({
      success: true,
      data: { resolution: "keep" },
    });

    const response = await PATCH(
      patchRequest({
        action: "resolve_difference",
        sourceFileId: "source-1",
        franchiseeId: "franchisee-1",
        resolution: "keep",
      }),
    );

    expect(response.status).toBe(200);
    expect(resolveDifference).toHaveBeenCalledWith({
      sourceFileId: "source-1",
      franchiseeId: "franchisee-1",
      resolution: "keep",
    });
  });
});
