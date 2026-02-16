import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getDocumentsByEntity,
  createDocument,
  isValidDocumentType,
  type DocumentEntityType,
} from "@/data-access/documents";
import {
  uploadDocument,
  isAllowedFileType,
  isFileSizeValid,
  getMaxFileSize,
  getAllowedMimeTypes,
} from "@/lib/storage";
import { randomUUID } from "crypto";

// Valid entity types
const VALID_ENTITY_TYPES: DocumentEntityType[] = ["supplier", "franchisee", "brand"];

function isValidEntityType(type: string): type is DocumentEntityType {
  return VALID_ENTITY_TYPES.includes(type as DocumentEntityType);
}

/**
 * GET /api/documents/[entityType]/[entityId] - Get all documents for an entity
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityType: string; entityId: string }> }
) {
  try {
    const authResult = await requireAuth(request);
    if (isAuthError(authResult)) return authResult;

    const { entityType, entityId } = await params;

    // Validate entity type
    if (!isValidEntityType(entityType)) {
      return NextResponse.json(
        { error: "Invalid entity type. Must be one of: supplier, franchisee, brand" },
        { status: 400 }
      );
    }

    const documents = await getDocumentsByEntity(entityType, entityId);

    return NextResponse.json({ documents });
  } catch (error) {
    console.error("Error fetching documents:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/documents/[entityType]/[entityId] - Upload a new document
 *
 * Supports two modes:
 * 1. JSON body (metadata-only) - file already uploaded to Vercel Blob via client-side upload
 * 2. Multipart form data - legacy flow where file passes through the serverless function
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entityType: string; entityId: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { entityType, entityId } = await params;

    // Validate entity type
    if (!isValidEntityType(entityType)) {
      return NextResponse.json(
        { error: "Invalid entity type. Must be one of: supplier, franchisee, brand" },
        { status: 400 }
      );
    }

    const contentType = request.headers.get("content-type") || "";

    // JSON body = metadata-only mode (file already uploaded to blob)
    if (contentType.includes("application/json")) {
      return handleJsonUpload(request, entityType, entityId, user);
    }

    // Multipart = legacy flow (file passes through serverless function)
    return handleMultipartUpload(request, entityType, entityId, user);
  } catch (error) {
    console.error("Error uploading document:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Handle metadata-only document creation (file already uploaded to Vercel Blob)
 */
async function handleJsonUpload(
  request: NextRequest,
  entityType: DocumentEntityType,
  entityId: string,
  user: { id: string; name: string; email: string }
) {
  const body = await request.json();
  const { name, description, documentType, fileUrl, fileName, fileSize, mimeType } = body;

  if (!name) {
    return NextResponse.json({ error: "Document name is required" }, { status: 400 });
  }
  if (!documentType || !isValidDocumentType(documentType)) {
    return NextResponse.json(
      { error: "Invalid document type. Must be one of: agreement, correspondence, invoice, other" },
      { status: 400 }
    );
  }
  if (!fileUrl || typeof fileUrl !== "string") {
    return NextResponse.json({ error: "File URL is required" }, { status: 400 });
  }
  if (!fileName || typeof fileName !== "string") {
    return NextResponse.json({ error: "File name is required" }, { status: 400 });
  }

  const documentId = randomUUID();
  const newDocument = await createDocument({
    id: documentId,
    name,
    description: description || null,
    documentType,
    status: "active",
    entityType,
    entityId,
    fileUrl,
    fileName,
    fileSize: typeof fileSize === "number" ? fileSize : 0,
    mimeType: mimeType || "application/octet-stream",
    version: 1,
    metadata: {
      originalFileName: fileName,
      storageType: "cloud",
    },
    createdBy: user.id,
  });

  return NextResponse.json(
    {
      document: {
        ...newDocument,
        uploaderName: user.name,
        uploaderEmail: user.email,
      },
    },
    { status: 201 }
  );
}

/**
 * Handle multipart form data upload (legacy flow - file passes through serverless function)
 */
async function handleMultipartUpload(
  request: NextRequest,
  entityType: DocumentEntityType,
  entityId: string,
  user: { id: string; name: string; email: string }
) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const name = formData.get("name") as string | null;
  const description = formData.get("description") as string | null;
  const documentType = formData.get("documentType") as string | null;

  if (!file) {
    return NextResponse.json({ error: "File is required" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Document name is required" }, { status: 400 });
  }
  if (!documentType || !isValidDocumentType(documentType)) {
    return NextResponse.json(
      { error: "Invalid document type. Must be one of: agreement, correspondence, invoice, other" },
      { status: 400 }
    );
  }
  if (!isAllowedFileType(file.type)) {
    return NextResponse.json(
      { error: "Invalid file type", allowedTypes: getAllowedMimeTypes() },
      { status: 400 }
    );
  }
  if (!isFileSizeValid(file.size)) {
    return NextResponse.json(
      { error: `File size exceeds maximum allowed size of ${getMaxFileSize() / 1024 / 1024}MB` },
      { status: 400 }
    );
  }

  const uploadResult = await uploadDocument(file, file.name, file.type, entityType, entityId);

  const documentId = randomUUID();
  const newDocument = await createDocument({
    id: documentId,
    name,
    description: description || null,
    documentType,
    status: "active",
    entityType,
    entityId,
    fileUrl: uploadResult.url,
    fileName: uploadResult.fileName,
    fileSize: uploadResult.fileSize,
    mimeType: uploadResult.mimeType,
    version: 1,
    metadata: {
      originalFileName: uploadResult.originalFileName,
      storageType: uploadResult.storageType,
    },
    createdBy: user.id,
  });

  return NextResponse.json(
    {
      document: {
        ...newDocument,
        uploaderName: user.name,
        uploaderEmail: user.email,
      },
    },
    { status: 201 }
  );
}
