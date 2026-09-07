import { NextRequest, NextResponse } from "next/server";

import { loadFranchiseeBillingAnnualReport } from "@/data-access/franchisee-billing-reports";
import {
  isAuthError,
  requireAdminOrSuperUser,
} from "@/lib/api-middleware";
import { buildFranchiseeBillingAnnualWorkbook } from "@/lib/franchisee-billing-annual-export";
import { hasAnnualData } from "@/lib/franchisee-billing-annual-summary";
import {
  checkRateLimit,
  createRateLimitHeaders,
  getClientIP,
  RateLimitConfigs,
} from "@/lib/rate-limit";
import {
  franchiseeBillingAnnualQuerySchema,
  type FranchiseeBillingAnnualPayload,
  type FranchiseeBillingAnnualQuery,
} from "@/schemas/franchisee-billing-annual";

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

function logCompletion(
  context: RequestContext,
  status: number,
  details: Record<string, unknown> = {},
): void {
  console.info(JSON.stringify({
    event: "franchisee_billing_annual_export",
    requestId: context.requestId,
    status,
    latencyMs: Date.now() - context.startedAt,
    ...details,
  }));
}

function rateLimitResponse(request: NextRequest): NextResponse | null {
  const limit = checkRateLimit(
    `franchisee-billing-annual-export:${getClientIP(request)}`,
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

function emptyResponse(
  report: FranchiseeBillingAnnualPayload,
  context: RequestContext,
): NextResponse {
  logCompletion(context, 400, {
    reportType: report.reportType,
    error: "empty",
  });
  return NextResponse.json(
    {
      success: false,
      error: "אין נתונים לייצוא בשנה שנבחרה",
      requestId: context.requestId,
    },
    { status: 400 },
  );
}

function workbookResponse(
  report: FranchiseeBillingAnnualPayload,
  context: RequestContext,
): NextResponse {
  const workbook = buildFranchiseeBillingAnnualWorkbook(report);
  const filename =
    `franchisee-billing-annual-${report.reportType}-${report.year}.xlsx`;
  logCompletion(context, 200, {
    reportType: report.reportType,
    year: report.year,
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
  input: FranchiseeBillingAnnualQuery,
  context: RequestContext,
): Promise<NextResponse> {
  try {
    const report = await loadFranchiseeBillingAnnualReport(input);
    return hasAnnualData(report.rows)
      ? workbookResponse(report, context)
      : emptyResponse(report, context);
  } catch (error: unknown) {
    console.error("[franchisee-billing-annual-export] Request failed", {
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

/** Exports the yearly grid as an RTL Excel workbook. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const context = requestContext(request);
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const limited = rateLimitResponse(request);
  if (limited) return limited;

  const validation = franchiseeBillingAnnualQuerySchema.safeParse({
    reportType: request.nextUrl.searchParams.get("reportType"),
    year: request.nextUrl.searchParams.get("year"),
    brandId: request.nextUrl.searchParams.get("brandId"),
  });
  if (validation.success) return exportResponse(validation.data, context);

  const error = validation.error.issues[0]?.message ?? "פרטי הדוח אינם תקינים";
  logCompletion(context, 400, { error: "validation" });
  return NextResponse.json(
    { success: false, error, requestId: context.requestId },
    { status: 400 },
  );
}
