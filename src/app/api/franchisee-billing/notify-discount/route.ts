import { render } from "@react-email/components";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import * as schema from "@/db/schema";
import {
  FranchiseeBillingEmail,
  franchiseeBillingEmailSubject,
  type FranchiseeBillingEmailProps,
} from "@/emails/franchisee-billing";
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
import { franchiseeBillingDiscountEmailSchema } from "@/schemas/franchisee-billing-approval";

export const runtime = "nodejs";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

interface DiscountNoticeRow {
  readonly id: string;
  readonly franchiseeName: string;
  readonly owners: readonly { readonly name: string; readonly email?: string }[] | null;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly status: string;
  readonly grossBase: string;
  readonly netBase: string;
  readonly tierRate: string;
  readonly discountRatePoints: string;
  readonly effectiveRate: string;
  readonly royaltyFull: string;
  readonly discountValue: string;
  readonly royalty: string;
  readonly marketingRateSnapshot: string | null;
  readonly marketing: string;
  readonly subtotal: string;
  readonly total: string;
}

async function loadRow(billingId: string): Promise<DiscountNoticeRow | null> {
  const { database } = await import("@/db");
  const billing = schema.franchiseeBilling;
  const [row] = await database
    .select({
      id: billing.id,
      franchiseeName: schema.franchisee.name,
      owners: schema.franchisee.owners,
      periodYear: billing.periodYear,
      periodMonth: billing.periodMonth,
      status: billing.status,
      grossBase: billing.grossBase,
      netBase: billing.netBase,
      tierRate: billing.tierRate,
      discountRatePoints: billing.discountRatePoints,
      effectiveRate: billing.effectiveRate,
      royaltyFull: billing.royaltyFull,
      discountValue: billing.discountValue,
      royalty: billing.royalty,
      marketingRateSnapshot: billing.marketingRateSnapshot,
      marketing: billing.marketing,
      subtotal: billing.subtotal,
      total: billing.total,
    })
    .from(billing)
    .innerJoin(
      schema.franchisee,
      eq(billing.franchiseeId, schema.franchisee.id),
    )
    .where(and(eq(billing.id, billingId)))
    .limit(1);
  return row ?? null;
}

/** Only an address that belongs to this franchisee's owners may receive it. */
export function resolveRecipients(
  row: DiscountNoticeRow,
  requested: readonly string[],
): readonly { readonly name: string; readonly email: string }[] | string {
  const owners = new Map(
    (row.owners ?? [])
      .filter((owner) => owner.email?.trim())
      .map((owner) => [normalizeEmail(owner.email ?? ""), owner]),
  );
  const seen = new Set<string>();
  const recipients: { name: string; email: string }[] = [];
  for (const email of requested) {
    const key = normalizeEmail(email);
    const owner = owners.get(key);
    if (!owner) {
      return `הכתובת ${email} אינה שייכת לבעלים של ${row.franchiseeName}`;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({
      name: owner.name.trim() || row.franchiseeName,
      email: owner.email?.trim() ?? email.trim(),
    });
  }
  return recipients;
}

function noticeProps(
  row: DiscountNoticeRow,
  ownerName: string,
): FranchiseeBillingEmailProps {
  return {
    ownerName,
    franchiseeName: row.franchiseeName,
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    grossBase: row.grossBase,
    netBase: row.netBase,
    tierRate: row.tierRate,
    discountRatePoints: row.discountRatePoints,
    effectiveRate: row.effectiveRate,
    royaltyFull: row.royaltyFull,
    discountValue: row.discountValue,
    royalty: row.royalty,
    marketingRateSnapshot: row.marketingRateSnapshot ?? "0",
    marketing: row.marketing,
    subtotal: row.subtotal,
    total: row.total,
  };
}

export function blockReason(row: DiscountNoticeRow): string | null {
  if (row.status !== "approved") {
    return "אפשר לשלוח הודעת הנחה רק אחרי אישור החודש";
  }
  if (!(Number(row.discountValue) > 0)) {
    return "לשורה הזו אין הנחה — אין מה להודיע";
  }
  return null;
}

async function deliver(
  row: DiscountNoticeRow,
  recipient: { readonly name: string; readonly email: string },
): Promise<{ readonly success: boolean; readonly error?: string }> {
  const props = noticeProps(row, recipient.name);
  const element = FranchiseeBillingEmail(props);
  const [html, text, emailService] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
    import("@/lib/email/service"),
  ]);
  return emailService.sendDirectEmail({
    to: recipient.email,
    subject: franchiseeBillingEmailSubject(props),
    html,
    text,
    entityType: "franchisee_billing",
    entityId: row.id,
    metadata: {
      messageKind: "franchisee_billing_discount_notice",
      periodYear: row.periodYear,
      periodMonth: row.periodMonth,
    },
  });
}

/**
 * POST /api/franchisee-billing/notify-discount — sends the discount notice for
 * ONE approved billing row to the owner addresses chosen on screen. This is
 * the only email the royalty module sends, and only a person triggers it.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get("x-vercel-id") ?? crypto.randomUUID();
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const limit = checkRateLimit(
    `franchisee-billing-discount-notice:${getClientIP(request)}`,
    RateLimitConfigs.api,
  );
  if (!limit.success) {
    return NextResponse.json(
      { success: false, error: "בוצעו יותר מדי בקשות. נסי שוב בעוד דקה", requestId },
      { status: 429, headers: createRateLimitHeaders(limit) },
    );
  }

  try {
    const validation = franchiseeBillingDiscountEmailSchema.safeParse(
      await request.json(),
    );
    if (!validation.success) {
      const error =
        validation.error.issues[0]?.message ?? "בקשת השליחה אינה תקינה";
      return NextResponse.json(
        { success: false, error, requestId },
        { status: 400 },
      );
    }

    const row = await loadRow(validation.data.billingId);
    if (!row) {
      return NextResponse.json(
        { success: false, error: "שורת החיוב לא נמצאה", requestId },
        { status: 404 },
      );
    }
    const blocked = blockReason(row);
    if (blocked) {
      return NextResponse.json(
        { success: false, error: blocked, requestId },
        { status: 409 },
      );
    }
    const recipients = resolveRecipients(row, validation.data.emails);
    if (typeof recipients === "string") {
      return NextResponse.json(
        { success: false, error: recipients, requestId },
        { status: 409 },
      );
    }

    const failures: { email: string; error: string }[] = [];
    let sent = 0;
    for (const recipient of recipients) {
      try {
        const result = await deliver(row, recipient);
        if (result.success) {
          sent += 1;
        } else {
          failures.push({
            email: recipient.email,
            error: result.error ?? "שירות המייל דחה את השליחה",
          });
        }
      } catch (error: unknown) {
        failures.push({
          email: recipient.email,
          error: error instanceof Error ? error.message : "שגיאת שליחה לא ידועה",
        });
      }
    }
    for (const failure of failures) {
      console.error("[franchisee-billing-discount-notice] delivery failed", failure);
    }
    console.info(JSON.stringify({
      event: "franchisee_billing_discount_notice",
      requestId,
      billingId: row.id,
      sent,
      failed: failures.length,
    }));
    if (failures.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `${failures.length} הודעות לא נשלחו`,
          data: { sent, failures },
          requestId,
        },
        { status: 207 },
      );
    }
    return NextResponse.json({
      success: true,
      data: { sent, failures: [] },
      requestId,
    });
  } catch (error: unknown) {
    console.error("[franchisee-billing-discount-notice] Request failed", {
      requestId,
      error,
    });
    return NextResponse.json(
      {
        success: false,
        error: `אירעה שגיאה זמנית בשליחת ההודעה. קוד פנייה: ${requestId}`,
        requestId,
      },
      { status: 500 },
    );
  }
}
