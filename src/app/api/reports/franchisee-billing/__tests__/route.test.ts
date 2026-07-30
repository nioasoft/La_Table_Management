import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { loadReport } = vi.hoisted(() => ({
  loadReport: vi.fn(),
}));

vi.mock("@/lib/api-middleware", () => ({
  requireAdminOrSuperUser: vi.fn(async () => ({
    session: { id: "session-1" },
    user: { id: "admin-1", role: "admin", status: "active" },
  })),
  isAuthError: vi.fn(() => false),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({
    success: true,
    limit: 100,
    remaining: 99,
    reset: Date.now() + 60_000,
  })),
  createRateLimitHeaders: vi.fn(() => ({})),
  getClientIP: vi.fn(() => "127.0.0.1"),
  RateLimitConfigs: { api: { limit: 100, windowMs: 60_000 } },
}));

vi.mock("@/data-access/franchisee-billing-reports", () => ({
  loadFranchiseeBillingReport: loadReport,
}));

import { GET } from "@/app/api/reports/franchisee-billing/route";

describe("GET /api/reports/franchisee-billing", () => {
  beforeEach(() => {
    loadReport.mockReset();
  });

  it("rejects an unknown report type in Hebrew", async () => {
    const response = await GET(new NextRequest(
      "http://localhost/api/reports/franchisee-billing?reportType=other&year=2026&month=6",
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "סוג הדוח אינו תקין",
    });
    expect(loadReport).not.toHaveBeenCalled();
  });

  it("returns one selected report projection", async () => {
    loadReport.mockResolvedValue({
      reportType: "turnover",
      period: { year: 2026, month: 6 },
      rows: [],
    });

    const response = await GET(new NextRequest(
      "http://localhost/api/reports/franchisee-billing?reportType=turnover&year=2026&month=6",
    ));

    expect(response.status).toBe(200);
    expect(loadReport).toHaveBeenCalledWith({
      reportType: "turnover",
      year: 2026,
      month: 6,
    });
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        reportType: "turnover",
        period: { year: 2026, month: 6 },
        rows: [],
      },
    });
  });
});
