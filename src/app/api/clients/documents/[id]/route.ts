/**
 * Client Document Detail API
 *
 * GET    /api/clients/documents/[id] - Get document details
 * PATCH  /api/clients/documents/[id] - Update document status/notes
 * DELETE /api/clients/documents/[id] - Delete document
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  getClientDocumentById,
  updateClientDocument,
  deleteClientDocument,
} from "@/data-access/client-documents";
import { deleteDocumentFile } from "@/lib/storage";
import { database } from "@/db";
import { clientDocument, franchisee, clientFranchisee } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { id } = await params;

  try {
    const document = await getClientDocumentById(id);
    if (!document) {
      return NextResponse.json({ error: "מסמך לא נמצא" }, { status: 404 });
    }
    return NextResponse.json(document);
  } catch (error) {
    console.error("Error fetching client document:", error);
    return NextResponse.json({ error: "שגיאה בטעינת מסמך" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  const { id } = await params;

  try {
    const body = await request.json();
    const { processingStatus, reviewNotes, franchiseeId } = body;

    const existing = await getClientDocumentById(id);
    if (!existing) {
      return NextResponse.json({ error: "מסמך לא נמצא" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};

    if (processingStatus) {
      updateData.processingStatus = processingStatus;
      updateData.reviewedBy = user.id;
      updateData.reviewedAt = new Date();
    }
    if (reviewNotes !== undefined) {
      updateData.reviewNotes = reviewNotes;
    }
    if (franchiseeId !== undefined && franchiseeId !== existing.franchiseeId) {
      // Verify franchisee exists
      const [franchiseeRecord] = await database
        .select({ id: franchisee.id })
        .from(franchisee)
        .where(eq(franchisee.id, franchiseeId))
        .limit(1);
      if (!franchiseeRecord) {
        return NextResponse.json(
          { error: "הזכיין שנבחר לא קיים" },
          { status: 400 }
        );
      }

      // Verify franchisee is linked to the document's client (if document has a client)
      if (existing.clientId) {
        const [link] = await database
          .select({ franchiseeId: clientFranchisee.franchiseeId })
          .from(clientFranchisee)
          .where(
            and(
              eq(clientFranchisee.clientId, existing.clientId),
              eq(clientFranchisee.franchiseeId, franchiseeId)
            )
          )
          .limit(1);
        if (!link) {
          return NextResponse.json(
            { error: "הזכיין אינו משויך ללקוח של מסמך זה" },
            { status: 400 }
          );
        }
      }

      // Prevent duplicate: another doc of same type/period/client/franchisee
      if (existing.clientId && existing.periodMonth && existing.periodYear) {
        const [duplicate] = await database
          .select({ id: clientDocument.id })
          .from(clientDocument)
          .where(
            and(
              ne(clientDocument.id, id),
              eq(clientDocument.clientId, existing.clientId),
              eq(clientDocument.franchiseeId, franchiseeId),
              eq(clientDocument.documentType, existing.documentType),
              eq(clientDocument.periodMonth, existing.periodMonth),
              eq(clientDocument.periodYear, existing.periodYear)
            )
          )
          .limit(1);
        if (duplicate) {
          return NextResponse.json(
            {
              error:
                "כבר קיים מסמך מאותו סוג ותקופה לזכיין זה — לא ניתן לבצע שיוך כפול",
            },
            { status: 409 }
          );
        }
      }

      updateData.franchiseeId = franchiseeId;
      // Track this as a manual review action
      updateData.reviewedBy = user.id;
      updateData.reviewedAt = new Date();
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(existing);
    }

    const updated = await updateClientDocument(id, updateData);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating client document:", error);
    return NextResponse.json({ error: "שגיאה בעדכון מסמך" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { id } = await params;

  try {
    const existing = await getClientDocumentById(id);
    if (!existing) {
      return NextResponse.json({ error: "מסמך לא נמצא" }, { status: 404 });
    }

    // Delete file from storage
    if (existing.fileUrl) {
      await deleteDocumentFile(existing.fileUrl);
    }

    // Delete from DB
    await deleteClientDocument(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting client document:", error);
    return NextResponse.json({ error: "שגיאה במחיקת מסמך" }, { status: 500 });
  }
}
