import { NextRequest, NextResponse } from "next/server";

import { loadFranchiseeBillingReport } from "@/data-access/franchisee-billing-reports";
import {
  isAuthError,
  requireAdminOrSuperUser,
} from "@/lib/api-middleware";
import { buildFranchiseeBillingReportWorkbook } from "@/lib/franchisee-billing-report-export";
import {
  checkRateLimit,
  createRateLimitHeaders,
  getClientIP,
  RateLimitConfigs,
} from "@/lib/rate-limit";
import {
  franchiseeBillingReportQuerySchema,
  type FranchiseeBillingReportPayload,
  type FranchiseeBillingReportQuery,
} from "@/schemas/franchisee-billing-reports";

export const runtime = "nodejs";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface RequestContext {
  readonly requestId: string;
  readonly startedAt: number;
}

function requestContext(request: NextRequest): RequestContext {
  return {
    requestId: request.headers.get("x-vercel-id") ?? crypto.randomUUID(),
    startedAt: Date.now(),
  };
}

function rateLimitResponse(request: NextRequest): NextResponse | null {
  const limit = checkRateLimit(
    `franchisee-billing-report-export:${getClientIP(request)}`,
    RateLimitConfigs.api,
  );
  if (limit.success) return null;
  return NextResponse.json(
    {
      success: false,
      error: "בוצעו יותר מדי בקשות. נסי שוב בעוד דקה",
    },
    { status: 429, headers: createRateLimitHeaders(limit) },
  );
}

function logCompletion(
  context: RequestContext,
  status: number,
  details: Record<string, unknown> = {},
): void {
  console.info(JSON.stringify({
    event: "franchisee_billing_report_export",
    requestId: context.requestId,
    status,
    latencyMs: Date.now() - context.startedAt,
    ...details,
  }));
}

function reportFilename(
  reportType: string,
  year: number,
  month: number,
): string {
  return `franchisee-billing-${reportType}-${year}-${String(month).padStart(2, "0")}.xlsx`;
}

function emptyResponse(
  report: FranchiseeBillingReportPayload,
  context: RequestContext,
): NextResponse {
  logCompletion(context, 400, {
    reportType: report.reportType,
    error: "empty",
  });
  return NextResponse.json(
    {
      success: false,
      error: "אין נתונים לייצוא בדוח שנבחר",
      requestId: context.requestId,
    },
    { status: 400 },
  );
}

function workbookResponse(
  report: FranchiseeBillingReportPayload,
  context: RequestContext,
): NextResponse {
  const workbook = buildFranchiseeBillingReportWorkbook(report);
  const filename = reportFilename(
    report.reportType,
    report.period.year,
    report.period.month,
  );
  logCompletion(context, 200, {
    reportType: report.reportType,
    rows: report.rows.length,
  });
  const responseBytes = new Uint8Array(workbook.byteLength);
  responseBytes.set(workbook);
  return new NextResponse(responseBytes.buffer, {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Request-Id": context.requestId,
    },
  });
}

async function exportResponse(
  input: FranchiseeBillingReportQuery,
  context: RequestContext,
): Promise<NextResponse> {
  try {
    const report = await loadFranchiseeBillingReport(input);
    return report.rows.length === 0
      ? emptyResponse(report, context)
      : workbookResponse(report, context);
  } catch (error: unknown) {
    console.error("[franchisee-billing-report-export] Request failed", {
      requestId: context.requestId, error,
    });
    logCompletion(context, 500, { error: "unexpected" });
    return NextResponse.json(
      {
        success: false,
        error: `אירעה שגיאה זמנית בייצוא הדוח. קוד פנייה: ${context.requestId}`,
        requestId: context.requestId,
      },
      { status: 500 },
    );
  }
}

/**
 * Exports the selected report projection as an RTL Excel workbook.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const context = requestContext(request);
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const limited = rateLimitResponse(request);
  if (limited) return limited;

  const validation = franchiseeBillingReportQuerySchema.safeParse({
    reportType: request.nextUrl.searchParams.get("reportType"),
    year: request.nextUrl.searchParams.get("year"),
    month: request.nextUrl.searchParams.get("month"),
  });
  if (validation.success) return exportResponse(validation.data, context);

  const error = validation.error.issues[0]?.message ?? "פרטי הדוח אינם תקינים";
  logCompletion(context, 400, { error: "validation" });
  return NextResponse.json(
    { success: false, error, requestId: context.requestId },
    { status: 400 },
  );
}
