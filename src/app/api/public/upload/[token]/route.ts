import { NextRequest, NextResponse } from "next/server";
import {
  getUploadLinkByToken,
  isUploadLinkValid,
  createUploadedFile,
  getUploadedFilesCount,
  markUploadLinkAsUsed,
} from "@/data-access/uploadLinks";
import {
  uploadDocument,
  isAllowedFileType,
  isFileSizeValid,
  getMaxFileSize,
  getAllowedMimeTypes,
} from "@/lib/storage";
import { validateFileType } from "@/lib/file-validation";
import { randomUUID } from "crypto";
import { notifySuperUsersAboutUpload } from "@/lib/notifications";

/**
 * GET /api/public/upload/[token] - Get upload link info (public, no auth required)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Get upload link by token
    const link = await getUploadLinkByToken(token);

    if (!link) {
      return NextResponse.json(
        { error: "קישור לא נמצא", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    // Check if link is valid
    const validation = isUploadLinkValid(link);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.reason, code: "INVALID_LINK" },
        { status: 400 }
      );
    }

    // Parse allowed file types
    const allowedFileTypes = link.allowedFileTypes
      ? link.allowedFileTypes.split(",").map((t) => t.trim())
      : getAllowedMimeTypes();

    // Return public info about the upload link
    return NextResponse.json({
      uploadLink: {
        id: link.id,
        name: link.name,
        description: link.description,
        entityType: link.entityType,
        entityName: link.entityName,
        allowedFileTypes,
        maxFileSize: link.maxFileSize || getMaxFileSize(),
        maxFiles: link.maxFiles,
        filesUploaded: link.filesUploaded || 0,
        expiresAt: link.expiresAt,
      },
    });
  } catch (error) {
    console.error("Error fetching upload link:", error);
    return NextResponse.json(
      { error: "שגיאה פנימית", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/public/upload/[token] - Upload file to an upload link (public, no auth required)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Get upload link by token
    const link = await getUploadLinkByToken(token);

    if (!link) {
      return NextResponse.json(
        { error: "קישור לא נמצא", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    // Check if link is valid
    const validation = isUploadLinkValid(link);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.reason, code: "INVALID_LINK" },
        { status: 400 }
      );
    }

    // Check if max files limit reached
    const currentFilesCount = await getUploadedFilesCount(link.id);
    if (currentFilesCount >= link.maxFiles) {
      return NextResponse.json(
        { error: "הגעת למספר הקבצים המקסימלי המותר", code: "MAX_FILES_REACHED" },
        { status: 400 }
      );
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const uploaderEmail = formData.get("email") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "נדרש קובץ", code: "FILE_REQUIRED" },
        { status: 400 }
      );
    }

    // Validate file type (client-provided MIME type)
    const allowedTypes = link.allowedFileTypes
      ? link.allowedFileTypes.split(",").map((t) => t.trim())
      : getAllowedMimeTypes();

    if (!allowedTypes.includes(file.type) && !isAllowedFileType(file.type)) {
      return NextResponse.json(
        {
          error: "סוג קובץ לא מורשה",
          code: "INVALID_FILE_TYPE",
          allowedTypes,
        },
        { status: 400 }
      );
    }

    // Early size check BEFORE loading file into memory to prevent memory exhaustion attacks
    const maxSize = link.maxFileSize || getMaxFileSize();
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          error: `גודל הקובץ חורג מהמקסימום המותר (${Math.round(maxSize / 1024 / 1024)}MB)`,
          code: "FILE_TOO_LARGE",
        },
        { status: 400 }
      );
    }

    // Convert to buffer for magic byte validation
    const buffer = Buffer.from(await file.arrayBuffer());

    // Validate file content matches claimed type (magic byte detection)
    // This prevents MIME type spoofing attacks
    const fileValidation = await validateFileType(buffer, file.type);
    if (!fileValidation.valid) {
      console.warn("File upload rejected - type mismatch:", {
        claimed: file.type,
        detected: fileValidation.detectedMimeType,
        error: fileValidation.error,
        uploadLinkId: link.id,
        uploaderEmail,
      });
      return NextResponse.json(
        {
          error: "תוכן הקובץ אינו תואם לסוג המוצהר",
          code: "FILE_TYPE_MISMATCH",
        },
        { status: 400 }
      );
    }

    // Secondary size validation using actual buffer length (defense in depth)
    // This catches cases where file.size was spoofed or inaccurate
    if (buffer.length > maxSize) {
      return NextResponse.json(
        {
          error: `גודל הקובץ חורג מהמקסימום המותר (${Math.round(maxSize / 1024 / 1024)}MB)`,
          code: "FILE_TOO_LARGE",
        },
        { status: 400 }
      );
    }

    // Upload the file to storage using validated buffer
    const uploadResult = await uploadDocument(
      buffer,
      file.name,
      fileValidation.detectedMimeType || file.type,
      link.entityType,
      link.entityId
    );

    // Get client IP
    const forwardedFor = request.headers.get("x-forwarded-for");
    const clientIp = forwardedFor
      ? forwardedFor.split(",")[0].trim()
      : request.headers.get("x-real-ip") || "unknown";

    // Create uploaded file record
    const uploadedFileRecord = await createUploadedFile({
      id: randomUUID(),
      uploadLinkId: link.id,
      fileName: uploadResult.fileName,
      originalFileName: uploadResult.originalFileName,
      fileUrl: uploadResult.url,
      fileSize: uploadResult.fileSize,
      mimeType: uploadResult.mimeType,
      uploadedByEmail: uploaderEmail || null,
      uploadedByIp: clientIp,
      metadata: {
        storageType: uploadResult.storageType,
      },
    });

    // Check if we've reached max files and should mark as used
    const newFilesCount = currentFilesCount + 1;
    if (newFilesCount >= link.maxFiles) {
      await markUploadLinkAsUsed(link.id, uploaderEmail || undefined);
    }

    // Notify super users about the new upload (non-blocking)
    notifySuperUsersAboutUpload(link.id, uploadedFileRecord).catch((error) => {
      console.error("Failed to notify super users about upload:", error);
    });

    return NextResponse.json(
      {
        success: true,
        message: "הקובץ הועלה בהצלחה",
        file: {
          id: uploadedFileRecord.id,
          fileName: uploadedFileRecord.originalFileName,
          fileSize: uploadedFileRecord.fileSize,
          mimeType: uploadedFileRecord.mimeType,
        },
        filesRemaining: link.maxFiles - newFilesCount,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error uploading file:", error);
    return NextResponse.json(
      { error: "שגיאה בהעלאת הקובץ", code: "UPLOAD_ERROR" },
      { status: 500 }
    );
  }
}
