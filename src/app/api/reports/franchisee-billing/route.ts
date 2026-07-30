import { NextRequest, NextResponse } from "next/server";

import { loadFranchiseeBillingReport } from "@/data-access/franchisee-billing-reports";
import {
  isAuthError,
  requireAdminOrSuperUser,
} from "@/lib/api-middleware";
import {
  checkRateLimit,
  createRateLimitHeaders,
  getClientIP,
  RateLimitConfigs,
} from "@/lib/rate-limit";
import {
  franchiseeBillingReportQuerySchema,
  type FranchiseeBillingReportQuery,
} from "@/schemas/franchisee-billing-reports";

export const runtime = "nodejs";

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
    event: "franchisee_billing_report",
    requestId: context.requestId,
    status,
    latencyMs: Date.now() - context.startedAt,
    ...details,
  }));
}

function rateLimitResponse(request: NextRequest): NextResponse | null {
  const limit = checkRateLimit(
    `franchisee-billing-report:${getClientIP(request)}`,
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

async function reportResponse(
  input: FranchiseeBillingReportQuery,
  context: RequestContext,
): Promise<NextResponse> {
  try {
    const data = await loadFranchiseeBillingReport(input);
    logCompletion(context, 200, {
      reportType: data.reportType,
      rows: data.rows.length,
    });
    return NextResponse.json({
      success: true,
      data,
      requestId: context.requestId,
    });
  } catch (error: unknown) {
    console.error("[franchisee-billing-report] Request failed", {
      requestId: context.requestId,
      error,
    });
    logCompletion(context, 500, { error: "unexpected" });
    return NextResponse.json(
      {
        success: false,
        error: `אירעה שגיאה זמנית בטעינת הדוח. קוד פנייה: ${context.requestId}`,
        requestId: context.requestId,
      },
      { status: 500 },
    );
  }
}

/**
 * Returns one of the four franchisee billing report projections.
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
  if (validation.success) return reportResponse(validation.data, context);

  const error = validation.error.issues[0]?.message ?? "פרטי הדוח אינם תקינים";
  logCompletion(context, 400, { error: "validation" });
  return NextResponse.json(
    { success: false, error, requestId: context.requestId },
    { status: 400 },
  );
}
