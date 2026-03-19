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
    const { processingStatus, reviewNotes } = body;

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
