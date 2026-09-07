import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { FranchiseeBillingAnnualPayload } from "@/schemas/franchisee-billing-annual";

const { loadAnnualReport } = vi.hoisted(() => ({
  loadAnnualReport: vi.fn(),
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
  loadFranchiseeBillingAnnualReport: loadAnnualReport,
}));

import { GET } from "@/app/api/reports/franchisee-billing/annual/route";
import { GET as EXPORT_GET } from "@/app/api/reports/franchisee-billing/annual/export/route";

function months(filled: Record<number, string> = {}): (string | null)[] {
  return Array.from({ length: 12 }, (_, index) => filled[index + 1] ?? null);
}

function payload(
  rows: FranchiseeBillingAnnualPayload["rows"],
): FranchiseeBillingAnnualPayload {
  return { reportType: "turnover", year: 2026, rows };
}

const filledRow = {
  franchiseeId: "f-1",
  franchiseeName: "סידיוס בע״מ",
  brandName: "פט ויני",
  months: months({ 7: "1000" }),
  total: "1000",
  average: "1000",
  ratePercent: null,
  turnoverTotal: null,
};

function request(search: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/reports/franchisee-billing/annual${search}`,
  );
}

beforeEach(() => {
  loadAnnualReport.mockReset();
});

describe("GET /api/reports/franchisee-billing/annual", () => {
  it("returns the payload in the standard envelope", async () => {
    loadAnnualReport.mockResolvedValue(payload([filledRow]));

    const response = await GET(request("?reportType=turnover&year=2026"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.rows).toHaveLength(1);
    expect(loadAnnualReport).toHaveBeenCalledWith({
      reportType: "turnover",
      year: 2026,
      brandId: null,
    });
  });

  it("passes the brand filter through", async () => {
    loadAnnualReport.mockResolvedValue(payload([filledRow]));

    await GET(request("?reportType=royalties&year=2026&brandId=brand-1"));

    expect(loadAnnualReport).toHaveBeenCalledWith({
      reportType: "royalties",
      year: 2026,
      brandId: "brand-1",
    });
  });

  it("rejects a year outside the supported range with a Hebrew message", async () => {
    const response = await GET(request("?reportType=turnover&year=1999"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("שנת הדוח אינה תקינה");
    expect(loadAnnualReport).not.toHaveBeenCalled();
  });

  it("rejects an unknown report type", async () => {
    const response = await GET(request("?reportType=collection&year=2026"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "סוג הדוח אינו תקין",
    });
  });
});

describe("GET /api/reports/franchisee-billing/annual/export", () => {
  it("streams a workbook when at least one month carries data", async () => {
    loadAnnualReport.mockResolvedValue(payload([filledRow]));

    const response = await EXPORT_GET(request("?reportType=turnover&year=2026"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("Content-Disposition")).toContain(
      "franchisee-billing-annual-turnover-2026.xlsx",
    );
  });

  // Every active branch is listed even when nothing was billed, so a grid of
  // names with no numbers is the real "empty" — not a zero-length row list.
  it("refuses to export a year where no month was billed", async () => {
    loadAnnualReport.mockResolvedValue(
      payload([{ ...filledRow, months: months(), total: "0", average: null }]),
    );

    const response = await EXPORT_GET(request("?reportType=turnover&year=2025"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "אין נתונים לייצוא בשנה שנבחרה",
    });
  });
});
