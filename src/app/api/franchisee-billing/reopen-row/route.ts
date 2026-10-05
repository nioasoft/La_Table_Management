import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { database } from "@/db";
import {
  reopenApprovedBillingRow,
  type ReopenBillingRowResult,
} from "@/data-access/franchisee-billing-reopen-row";
import { isAuthError, requireSuperUser } from "@/lib/api-middleware";
import {
  checkRateLimit,
  createRateLimitHeaders,
  getClientIP,
  RateLimitConfigs,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

const reopenRowSchema = z.strictObject({
  billingId: z.string().trim().min(1, "מזהה שורת החיוב חסר"),
});

const FAILURES: Readonly<
  Record<Exclude<ReopenBillingRowResult, "reopened">, readonly [number, string]>
> = {
  not_found: [404, "שורת החיוב לא נמצאה"],
  not_approved: [409, "השורה כבר פתוחה לעריכה"],
  exported: [409, "השורה כבר יוצאה לחשבשבת ולא ניתן לפתוח אותה"],
};

/**
 * Reopens one approved royalty row for editing. Super user only, like the
 * month lock it undoes.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get("x-vercel-id") ?? crypto.randomUUID();
  const authResult = await requireSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const limit = checkRateLimit(
    `franchisee-billing-reopen-row:${getClientIP(request)}`,
    RateLimitConfigs.api,
  );
  if (!limit.success) {
    return NextResponse.json(
      { success: false, error: "בוצעו יותר מדי בקשות. נסי שוב בעוד דקה" },
      { status: 429, headers: createRateLimitHeaders(limit) },
    );
  }

  try {
    const validation = reopenRowSchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.issues[0]?.message ?? "הבקשה אינה תקינה",
          requestId,
        },
        { status: 400 },
      );
    }
    const { billingId } = validation.data;
    const result = await reopenApprovedBillingRow(database, billingId);
    console.info(JSON.stringify({
      event: "franchisee_billing_reopen_row",
      requestId,
      billingId,
      userId: authResult.user.id,
      result,
    }));
    if (result !== "reopened") {
      const [status, error] = FAILURES[result];
      return NextResponse.json({ success: false, error, requestId }, { status });
    }
    return NextResponse.json({ success: true, data: { billingId }, requestId });
  } catch (error: unknown) {
    console.error("[franchisee-billing-reopen-row] Request failed", { requestId, error });
    return NextResponse.json(
      {
        success: false,
        error: `פתיחת השורה נכשלה. קוד פנייה: ${requestId}`,
        requestId,
      },
      { status: 500 },
    );
  }
}
