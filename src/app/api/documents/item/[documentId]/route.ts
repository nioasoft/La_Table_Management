import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getDocumentById,
  updateDocument,
  deleteDocument,
  isValidDocumentType,
} from "@/data-access/documents";
import { deleteDocumentFile } from "@/lib/storage";
import type { DocumentStatus } from "@/db/schema";

/**
 * GET /api/documents/[documentId] - Get a single document
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { documentId } = await params;

    const document = await getDocumentById(documentId);

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ document });
  } catch (error) {
    console.error("Error fetching document:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/documents/[documentId] - Update a document
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin or super_user
    const userRole = (session.user as typeof session.user & { role?: string }).role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { documentId } = await params;

    // Check if document exists
    const existingDocument = await getDocumentById(documentId);
    if (!existingDocument) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { name, description, documentType, status } = body;

    // Build update data
    const updateData: {
      name?: string;
      description?: string | null;
      documentType?: string;
      status?: DocumentStatus;
    } = {};

    if (name !== undefined) {
      if (!name.trim()) {
        return NextResponse.json(
          { error: "Document name cannot be empty" },
          { status: 400 }
        );
      }
      updateData.name = name;
    }

    if (description !== undefined) {
      updateData.description = description || null;
    }

    if (documentType !== undefined) {
      if (!isValidDocumentType(documentType)) {
        return NextResponse.json(
          { error: "Invalid document type. Must be one of: agreement, correspondence, invoice, other" },
          { status: 400 }
        );
      }
      updateData.documentType = documentType;
    }

    if (status !== undefined) {
      const validStatuses: DocumentStatus[] = ["draft", "active", "expired", "archived"];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: "Invalid status. Must be one of: draft, active, expired, archived" },
          { status: 400 }
        );
      }
      updateData.status = status;
    }

    // Update the document
    const updatedDocument = await updateDocument(documentId, updateData);

    if (!updatedDocument) {
      return NextResponse.json(
        { error: "Failed to update document" },
        { status: 500 }
      );
    }

    // Get updated document with uploader info
    const documentWithUploader = await getDocumentById(documentId);

    return NextResponse.json({ document: documentWithUploader });
  } catch (error) {
    console.error("Error updating document:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/documents/[documentId] - Delete a document
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is super_user (only super_user can delete)
    const userRole = (session.user as typeof session.user & { role?: string }).role;
    if (userRole !== "super_user") {
      return NextResponse.json(
        { error: "Only super users can delete documents" },
        { status: 403 }
      );
    }

    const { documentId } = await params;

    // Get the document to find file info
    const document = await getDocumentById(documentId);
    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    // Delete the file from storage
    if (document.fileUrl && document.fileName) {
      await deleteDocumentFile(
        document.fileUrl,
        document.entityType,
        document.entityId,
        document.fileName
      );
    }

    // Delete the document record
    const deleted = await deleteDocument(documentId);

    if (!deleted) {
      return NextResponse.json(
        { error: "Failed to delete document" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting document:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
