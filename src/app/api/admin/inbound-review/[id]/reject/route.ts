/**
 * POST /api/admin/inbound-review/:id/reject
 *
 * Mark a queue row as resolved without creating a client_document.
 * Use when an inbound email was a false positive (test, spam, vendor
 * misroute) and there's nothing to commit.
 *
 * Body: { reviewNotes?: string }
 *
 * Auth: admin or super_user.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { inboundReviewQueue } from "@/db/schema";
import { eq } from "drizzle-orm";

const RejectBody = z.object({
  reviewNotes: z.string().max(2000).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  const { id } = await context.params;

  const parsed = RejectBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "פרמטרים לא תקינים", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { reviewNotes } = parsed.data;

  const [queueRow] = await database
    .select({
      id: inboundReviewQueue.id,
      status: inboundReviewQueue.status,
      committedClientDocumentId: inboundReviewQueue.committedClientDocumentId,
    })
    .from(inboundReviewQueue)
    .where(eq(inboundReviewQueue.id, id))
    .limit(1);

  if (!queueRow) {
    return NextResponse.json({ error: "רשומה לא נמצאה" }, { status: 404 });
  }
  if (queueRow.status === "auto_committed") {
    return NextResponse.json(
      { error: "לא ניתן לדחות רשומה שכבר אושרה" },
      { status: 409 },
    );
  }
  if (
    queueRow.status === "needs_review" &&
    queueRow.committedClientDocumentId
  ) {
    return NextResponse.json(
      {
        error:
          'לא ניתן לדחות רשומה ב-needs_review (המסמך כבר נוצר). השתמש ב"אשר" כדי לתקן את הזכיין, או מחק את המסמך ידנית מ-/admin/clients/documents.',
      },
      { status: 422 },
    );
  }

  await database
    .update(inboundReviewQueue)
    .set({
      status: "rejected",
      reviewedBy: user.id,
      reviewedAt: new Date(),
      reviewNotes: reviewNotes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(inboundReviewQueue.id, id));

  return NextResponse.json({ ok: true });
}
