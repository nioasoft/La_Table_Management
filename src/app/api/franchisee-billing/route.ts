import { NextRequest, NextResponse } from "next/server";

import {
  loadFranchiseeBillingScreen,
  resolveApprovedBillingDifference,
  updateBillingDiscount,
  updateBillingNoRevenueReason,
  type BillingScreenOperations,
} from "@/data-access/franchisee-billing-screen";
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
  franchiseeBillingMutationSchema,
  franchiseeBillingPeriodSchema,
  type FranchiseeBillingMutation,
} from "@/schemas/franchisee-billing-screen";

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
  method: "GET" | "PATCH",
  status: number,
  details: Record<string, unknown> = {},
): void {
  console.info(JSON.stringify({
    event: "franchisee_billing_screen",
    method,
    requestId: context.requestId,
    status,
    latencyMs: Date.now() - context.startedAt,
    ...details,
  }));
}

function rateLimitResponse(request: NextRequest): NextResponse | null {
  const limit = checkRateLimit(
    `franchisee-billing-screen:${getClientIP(request)}`,
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

function unexpectedError(
  error: unknown,
  context: RequestContext,
  method: "GET" | "PATCH",
): NextResponse {
  console.error("[franchisee-billing-screen] Request failed", {
    requestId: context.requestId,
    error,
  });
  logCompletion(context, method, 500, { error: "unexpected" });
  return NextResponse.json(
    {
      success: false,
      error: `אירעה שגיאה זמנית בטעינת החיובים. קוד פנייה: ${context.requestId}`,
      requestId: context.requestId,
    },
    { status: 500 },
  );
}

function mutationFailureStatus(code: string): number {
  if (code === "not_found") return 404;
  if (
    code === "approved" ||
    code === "conflict" ||
    code === "exported"
  ) {
    return 409;
  }
  return 422;
}

async function applyMutation(
  mutation: FranchiseeBillingMutation,
  operations?: BillingScreenOperations,
) {
  if (mutation.action === "update_discount") {
    return operations
      ? updateBillingDiscount(
          mutation.billingId,
          mutation.discountRatePoints,
          operations,
        )
      : updateBillingDiscount(
          mutation.billingId,
          mutation.discountRatePoints,
        );
  }
  if (mutation.action === "update_no_revenue_reason") {
    return operations
      ? updateBillingNoRevenueReason(
          mutation.billingId,
          mutation.noRevenueReason,
          operations,
        )
      : updateBillingNoRevenueReason(
          mutation.billingId,
          mutation.noRevenueReason,
        );
  }
  const input = {
    sourceFileId: mutation.sourceFileId,
    franchiseeId: mutation.franchiseeId,
    resolution: mutation.resolution,
  };
  return operations
    ? resolveApprovedBillingDifference(input, operations)
    : resolveApprovedBillingDifference(input);
}

/**
 * Returns the stored billing screen projection for one month.
 */
export async function handleGetFranchiseeBilling(
  request: NextRequest,
  operations?: BillingScreenOperations,
): Promise<NextResponse> {
  const context = requestContext(request);
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const limited = rateLimitResponse(request);
  if (limited) return limited;

  const validation = franchiseeBillingPeriodSchema.safeParse({
    year: request.nextUrl.searchParams.get("year"),
    month: request.nextUrl.searchParams.get("month"),
  });
  if (!validation.success) {
    const error =
      validation.error.issues[0]?.message ?? "תקופת החיוב אינה תקינה";
    logCompletion(context, "GET", 400, { error: "validation" });
    return NextResponse.json(
      { success: false, error, requestId: context.requestId },
      { status: 400 },
    );
  }

  try {
    const data = await loadFranchiseeBillingScreen(
      validation.data,
      operations,
    );
    logCompletion(context, "GET", 200, {
      rows: data.rows.length,
      anomalies: data.anomalies.length,
      approvedDifferences: data.approvedDifferences.length,
    });
    return NextResponse.json({
      success: true,
      data,
      requestId: context.requestId,
    });
  } catch (error: unknown) {
    return unexpectedError(error, context, "GET");
  }
}

/**
 * Updates a draft discount or resolves an approved-file difference.
 */
export async function handlePatchFranchiseeBilling(
  request: NextRequest,
  operations?: BillingScreenOperations,
): Promise<NextResponse> {
  const context = requestContext(request);
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const limited = rateLimitResponse(request);
  if (limited) return limited;

  try {
    const body: unknown = await request.json();
    const validation = franchiseeBillingMutationSchema.safeParse(body);
    if (!validation.success) {
      const error =
        validation.error.issues[0]?.message ?? "הבקשה אינה תקינה";
      logCompletion(context, "PATCH", 400, { error: "validation" });
      return NextResponse.json(
        { success: false, error, requestId: context.requestId },
        { status: 400 },
      );
    }

    const mutation = validation.data;
    const result = await applyMutation(mutation, operations);
    if (!result.success) {
      const status = mutationFailureStatus(result.code);
      logCompletion(context, "PATCH", status, { error: result.code });
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          requestId: context.requestId,
        },
        { status },
      );
    }

    logCompletion(context, "PATCH", 200, { action: mutation.action });
    return NextResponse.json({
      success: true,
      data: result.data,
      requestId: context.requestId,
    });
  } catch (error: unknown) {
    return unexpectedError(error, context, "PATCH");
  }
}

/**
 * Next passes a route context as the second argument. Aliasing the export
 * straight to the handler fed that context into the tests-only operations
 * parameter, and every real request crashed on a missing operations method.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleGetFranchiseeBilling(request);
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  return handlePatchFranchiseeBilling(request);
}
