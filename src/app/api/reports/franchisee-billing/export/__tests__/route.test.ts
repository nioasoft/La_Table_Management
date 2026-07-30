import * as XLSX from "xlsx";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { FranchiseeBillingReportPayload } from "@/schemas/franchisee-billing-reports";

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

import { GET } from "@/app/api/reports/franchisee-billing/export/route";

interface ExportRouteCase {
  readonly report: FranchiseeBillingReportPayload;
  readonly sheetName: string;
  readonly expectedRows: readonly (readonly (string | number)[])[];
}

const period = { year: 2026, month: 6 } as const;
const exportCases: readonly ExportRouteCase[] = [
  {
    report: {
      reportType: "royalties",
      period,
      rows: [
        {
          franchiseeId: "franchisee-1",
          franchiseeName: "ויני חדרה",
          brandName: "פט ויני",
          royalty: "123.456789",
          tierRate: "5.00",
          effectiveRate: "4.00",
          discountValue: "31.123456",
          status: "approved",
        },
      ],
    },
    sheetName: "תמלוגים",
    expectedRows: [
      [
        "זכיין",
        "מותג",
        "תמלוגים",
        "תעריף הסכם",
        "תעריף בפועל",
        "ערך הנחה",
        "סטטוס",
      ],
      ["ויני חדרה", "פט ויני", 123.456789, 5, 4, 31.123456, "מאושר"],
    ],
  },
  {
    report: {
      reportType: "turnover",
      period,
      rows: [
        {
          franchiseeId: "franchisee-2",
          franchiseeName: "נתנזון",
          brandName: "נתנזון",
          grossBase: "1180.123456",
          netBase: "1000.104624",
          status: "approved",
        },
      ],
    },
    sheetName: "מחזורים",
    expectedRows: [
      ["זכיין", "מותג", "מחזור כולל מע״מ", "מחזור לפני מע״מ", "סטטוס"],
      ["נתנזון", "נתנזון", 1180.123456, 1000.104624, "מאושר"],
    ],
  },
  {
    report: {
      reportType: "collection",
      period,
      rows: [
        {
          franchiseeId: "franchisee-3",
          franchiseeName: "סניף השרון",
          brandName: "פט ויני",
          royaltyCollected: "300.123456",
          marketingCollected: "45.654321",
        },
      ],
    },
    sheetName: "גבייה",
    expectedRows: [
      ["זכיין", "מותג", "תמלוגים שנגבו", "שיווק שנגבה"],
      ["סניף השרון", "פט ויני", 300.123456, 45.654321],
    ],
  },
  {
    report: {
      reportType: "discounts",
      period,
      rows: [
        {
          franchiseeId: "franchisee-4",
          franchiseeName: "סניף הדרום",
          brandName: "לה טבלה",
          discountValue: "31.123456",
        },
      ],
    },
    sheetName: "ערך הנחות",
    expectedRows: [
      ["זכיין", "מותג", "ערך הנחות מצטבר"],
      ["סניף הדרום", "לה טבלה", 31.123456],
    ],
  },
];

describe("GET /api/reports/franchisee-billing/export", () => {
  beforeEach(() => {
    loadReport.mockReset();
  });

  it("does not create an empty workbook", async () => {
    loadReport.mockResolvedValue({
      reportType: "discounts",
      period: { year: 2026, month: 6 },
      rows: [],
    });

    const response = await GET(new NextRequest(
      "http://localhost/api/reports/franchisee-billing/export?reportType=discounts&year=2026&month=6",
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "אין נתונים לייצוא בדוח שנבחר",
    });
  });

  it.each(exportCases)(
    "round-trips the $report.reportType route export",
    async ({ report, sheetName, expectedRows }) => {
      loadReport.mockResolvedValue(report);
      const response = await GET(new NextRequest(
        "http://localhost/api/reports/franchisee-billing/export"
          + `?reportType=${report.reportType}&year=2026&month=6`,
      ));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      expect(response.headers.get("content-disposition")).toContain(
        `franchisee-billing-${report.reportType}-2026-06.xlsx`,
      );
      const workbook = XLSX.read(await response.arrayBuffer(), {
        type: "array",
      });
      const worksheet = workbook.Sheets[sheetName];

      expect(workbook.SheetNames).toEqual([sheetName]);
      expect(workbook.Workbook?.Views?.[0]?.RTL).toBe(true);
      expect(worksheet).toBeDefined();
      expect(
        XLSX.utils.sheet_to_json<(string | number)[]>(worksheet, {
          header: 1,
          raw: true,
        }),
      ).toEqual(expectedRows);
    },
  );
});
