import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { processUpload } = vi.hoisted(() => ({
  processUpload: vi.fn(),
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

vi.mock("@/lib/royalty-revenue-processor", () => ({
  processRoyaltyRevenueUpload: processUpload,
}));

import { POST } from "@/app/api/franchisee-billing/upload/route";

function uploadRequest(formData: FormData): NextRequest {
  return new NextRequest("http://localhost/api/franchisee-billing/upload", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/franchisee-billing/upload", () => {
  beforeEach(() => {
    processUpload.mockReset();
  });

  it("returns a Hebrew validation error when no file is provided", async () => {
    const response = await POST(uploadRequest(new FormData()));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      success: false,
      error: "נדרש קובץ Excel",
    });
  });

  it("returns the draft and anomaly result for a valid upload", async () => {
    processUpload.mockResolvedValue({
      success: true,
      period: { year: 2026, month: 6 },
      sourceFileId: "file-1",
      draftsWritten: 1,
      anomalies: [],
      approvedDifferences: [],
      errors: [],
      warnings: [],
      hasBlockingIssues: false,
    });
    const formData = new FormData();
    formData.set(
      "file",
      new File(["xlsx"], "יוני.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    const response = await POST(uploadRequest(formData));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      success: true,
      data: {
        sourceFileId: "file-1",
        draftsWritten: 1,
        hasBlockingIssues: false,
      },
    });
  });

  it("returns 422 for a parser-level blocking error", async () => {
    processUpload.mockResolvedValue({
      success: false,
      period: null,
      sourceFileId: null,
      draftsWritten: 0,
      anomalies: [],
      approvedDifferences: [],
      errors: ["הקובץ אינו מקובץ לפי חודש"],
      warnings: [],
      hasBlockingIssues: true,
    });
    const formData = new FormData();
    formData.set(
      "file",
      new File(["xlsx"], "שנתי.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    const response = await POST(uploadRequest(formData));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      success: false,
      error: "הקובץ אינו מקובץ לפי חודש",
    });
  });
});
