/**
 * POST /api/admin/inbound-review/:id/confirm
 *
 * Manual recovery of a `failed` inbound queue row. The admin picks a
 * franchisee and document type; we download the originally-uploaded
 * file from Vercel Blob, run it through `processClientDocument`, and
 * link the resulting client_document back to the queue row.
 *
 * Body: { franchiseeId: string, documentType: "client_report"|"commission_invoice", reviewNotes?: string }
 *
 * Auth: admin or super_user.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { inboundReviewQueue, client } from "@/db/schema";
import { eq } from "drizzle-orm";
import { processClientDocument } from "@/lib/client-document-processor";

const ConfirmBody = z.object({
  franchiseeId: z.string().uuid(),
  documentType: z.enum(["client_report", "commission_invoice"]),
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

  const parsed = ConfirmBody.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "פרמטרים לא תקינים", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { franchiseeId, documentType, reviewNotes } = parsed.data;

  // 1. Load the queue row
  const [queueRow] = await database
    .select()
    .from(inboundReviewQueue)
    .where(eq(inboundReviewQueue.id, id))
    .limit(1);

  if (!queueRow) {
    return NextResponse.json({ error: "רשומה לא נמצאה" }, { status: 404 });
  }
  if (queueRow.status === "auto_committed") {
    return NextResponse.json(
      { error: "רשומה כבר אושרה אוטומטית" },
      { status: 409 },
    );
  }

  // Borderline rows (status=needs_review) ALREADY have a committed
  // client_document — the admin is just verifying the franchisee/doc-type
  // assignment. If they confirm without changing anything, we just close
  // the review. If they pick a DIFFERENT franchisee/doc-type, we update
  // the existing client_document instead of creating a new one.
  if (queueRow.status === "needs_review" && queueRow.committedClientDocumentId) {
    const noChange =
      queueRow.proposedFranchiseeId === franchiseeId &&
      queueRow.proposedDocumentType === documentType;

    if (!noChange) {
      // Update the linked client_document with the admin's choice.
      const { clientDocument } = await import("@/db/schema");
      await database
        .update(clientDocument)
        .set({
          franchiseeId,
          documentType,
          updatedAt: new Date(),
        })
        .where(eq(clientDocument.id, queueRow.committedClientDocumentId));
    }

    await database
      .update(inboundReviewQueue)
      .set({
        status: "auto_committed",
        proposedFranchiseeId: franchiseeId,
        proposedDocumentType: documentType,
        reviewedBy: user.id,
        reviewedAt: new Date(),
        reviewNotes: reviewNotes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(inboundReviewQueue.id, id));

    return NextResponse.json({
      ok: true,
      clientDocumentId: queueRow.committedClientDocumentId,
      mode: noChange ? "verified" : "updated",
    });
  }

  // Below: status === "failed" (no client_document yet) — we need to
  // upload + run processClientDocument from scratch.
  if (!queueRow.fileUrl) {
    return NextResponse.json(
      { error: "אין קובץ מאוחסן לרשומה זו — לא ניתן לאשר" },
      { status: 422 },
    );
  }
  if (!queueRow.clientId) {
    return NextResponse.json(
      { error: "אין client_id ברשומה — לא ניתן לאשר" },
      { status: 422 },
    );
  }

  // 2. Resolve the parser code from the client.
  const [clientRow] = await database
    .select({
      id: client.id,
      code: client.code,
      parserCode: client.parserCode,
    })
    .from(client)
    .where(eq(client.id, queueRow.clientId))
    .limit(1);
  if (!clientRow) {
    return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 422 });
  }
  const parserCode = clientRow.parserCode || clientRow.code || "";
  if (!parserCode) {
    return NextResponse.json(
      { error: "ללקוח אין parser_code/code" },
      { status: 422 },
    );
  }

  // 3. Download the previously-uploaded file from Vercel Blob.
  let fileBuffer: Buffer;
  try {
    const res = await fetch(queueRow.fileUrl);
    if (!res.ok) {
      return NextResponse.json(
        { error: `לא ניתן להוריד את הקובץ: ${res.status}` },
        { status: 502 },
      );
    }
    fileBuffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return NextResponse.json(
      {
        error: "שגיאה בהורדת הקובץ",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  // 4. Run the standard pipeline with the manually-chosen franchisee.
  const result = await processClientDocument({
    buffer: fileBuffer,
    fileName: queueRow.fileName ?? "inbound-review.pdf",
    mimeType: queueRow.mimeType ?? "application/pdf",
    clientId: queueRow.clientId,
    parserCode,
    franchiseeId,
    periodMonth: queueRow.periodMonth ?? new Date().getMonth() + 1,
    periodYear: queueRow.periodYear ?? new Date().getFullYear(),
    documentType,
    source: "gmail_fetch",
    // Re-using the original gmail_message_id keeps the dedup index honest:
    // a re-delivery of the same email won't create a second client_document.
    // The queue row tracks the manual-recovery linkage separately via
    // committed_client_document_id.
    gmailMessageId: queueRow.gmailMessageId ?? `manual-${queueRow.id}`,
    userId: user.id,
    // Admin explicitly chose the target franchisee/type — replacing an
    // existing document for the same slot is intentional here, unlike the
    // unattended webhook path where the overwrite guard refuses it.
    allowReplace: true,
  });

  if (!result.success || !result.document) {
    return NextResponse.json(
      {
        error: "עיבוד המסמך נכשל",
        details: result.error ?? "unknown",
      },
      { status: 500 },
    );
  }

  // 5. Mark the queue row as resolved.
  await database
    .update(inboundReviewQueue)
    .set({
      status: "auto_committed",
      committedClientDocumentId: result.document.id,
      proposedFranchiseeId: franchiseeId,
      proposedDocumentType: documentType,
      reviewedBy: user.id,
      reviewedAt: new Date(),
      reviewNotes: reviewNotes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(inboundReviewQueue.id, id));

  return NextResponse.json({
    ok: true,
    clientDocumentId: result.document.id,
  });
}
