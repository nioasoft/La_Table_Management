import { put, del } from '@vercel/blob';
import path from "path";
import fs from "fs/promises";

// Local storage directory (for backward compatibility with existing local files)
const LOCAL_UPLOAD_DIR = path.join(process.cwd(), "uploads", "documents");

export interface UploadResult {
  url: string;
  fileName: string;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  storageType: "cloud" | "local";
}

export interface StorageError {
  message: string;
  code: string;
}

/**
 * Generate a unique file name
 */
function generateFileName(originalName: string): string {
  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext);
  const sanitizedBaseName = baseName
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .substring(0, 50);
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${sanitizedBaseName}_${timestamp}_${random}${ext}`;
}

// Allowed file extensions for entity file uploads
const ALLOWED_ENTITY_FILE_EXTENSIONS = [
  '.xlsx', '.xls', '.csv', '.txt', '.pdf', '.doc', '.docx',
  '.png', '.jpg', '.jpeg', '.gif'
];

/**
 * Generate a unique file name with entity name and period date.
 * Format: {entityName}_{periodStartDate}_{timestamp}_{random}.{ext}
 *
 * @param entityName - The name of the entity (supplier, franchisee)
 * @param periodStartDate - The period start date in YYYY-MM-DD format
 * @param originalName - The original file name (used for extension)
 * @throws Error if periodStartDate format is invalid or extension is not allowed
 */
export function generateEntityFileName(
  entityName: string,
  periodStartDate: string,
  originalName: string
): string {
  // Validate periodStartDate format (YYYY-MM-DD only, no path traversal)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStartDate)) {
    throw new Error(`Invalid period date format: ${periodStartDate}. Expected YYYY-MM-DD.`);
  }

  // Validate year is reasonable (1900-2100)
  const year = parseInt(periodStartDate.substring(0, 4), 10);
  if (year < 1900 || year > 2100) {
    throw new Error(`Invalid year in period date: ${year}. Expected 1900-2100.`);
  }

  // Get and validate extension
  const ext = path.extname(originalName).toLowerCase();
  if (ext && !ALLOWED_ENTITY_FILE_EXTENSIONS.includes(ext)) {
    throw new Error(`Invalid file extension: ${ext}. Allowed: ${ALLOWED_ENTITY_FILE_EXTENSIONS.join(', ')}`);
  }

  // Sanitize entity name - allow Hebrew characters and basic alphanumeric
  // Also remove any path separators that might have slipped through
  const sanitizedName = entityName
    .replace(/[^a-zA-Z0-9\u0590-\u05FF-_\s]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[\/\\]/g, "_") // Extra safety: remove path separators
    .substring(0, 30);

  // Use a fallback if entity name is empty after sanitization
  const finalName = sanitizedName || "file";

  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${finalName}_${periodStartDate}_${timestamp}_${random}${ext}`;
}

export interface UploadDocumentOptions {
  /** Custom file name to use instead of auto-generating one */
  customFileName?: string;
}

/**
 * Upload a document file to Vercel Blob
 */
export async function uploadDocument(
  file: File | Buffer,
  originalFileName: string,
  mimeType: string,
  entityType: string,
  entityId: string,
  options?: UploadDocumentOptions
): Promise<UploadResult> {
  const fileName = options?.customFileName || generateFileName(originalFileName);
  const pathname = `documents/${entityType}/${entityId}/${fileName}`;

  // Get buffer/file for upload
  const fileData = file instanceof File
    ? file
    : new Blob([new Uint8Array(file)], { type: mimeType });
  const fileSize = file instanceof File ? file.size : file.length;

  try {
    const blob = await put(pathname, fileData, {
      access: 'public',
      contentType: mimeType,
    });

    return {
      url: blob.url,
      fileName,
      originalFileName,
      fileSize,
      mimeType,
      storageType: "cloud",
    };
  } catch (error) {
    console.error("Error uploading document:", error);
    throw new Error("Failed to upload document");
  }
}

/**
 * Delete a document file from Vercel Blob
 */
export async function deleteDocumentFile(fileUrl: string): Promise<boolean> {
  try {
    await del(fileUrl);
    return true;
  } catch (error) {
    console.error("Error deleting document file:", error);
    return false;
  }
}

/**
 * Get a document from Vercel Blob by URL
 */
export async function getDocument(fileUrl: string): Promise<Buffer | null> {
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    console.error("Error getting document:", error);
    return null;
  }
}

/**
 * Get allowed MIME types for document uploads
 */
export function getAllowedMimeTypes(): string[] {
  return [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/jpeg",
    "image/png",
    "image/gif",
    "text/plain",
    "text/csv",
  ];
}

/**
 * Validate file type
 */
export function isAllowedFileType(mimeType: string): boolean {
  return getAllowedMimeTypes().includes(mimeType);
}

/**
 * Get max file size in bytes (10MB default)
 */
export function getMaxFileSize(): number {
  return 10 * 1024 * 1024; // 10MB
}

/**
 * Validate file size
 */
export function isFileSizeValid(size: number): boolean {
  return size <= getMaxFileSize();
}

/**
 * Read a local file (for backward compatibility with existing local files)
 */
export async function readLocalFile(
  entityType: string,
  entityId: string,
  fileName: string
): Promise<Buffer | null> {
  try {
    const filePath = path.join(LOCAL_UPLOAD_DIR, entityType, entityId, fileName);
    return await fs.readFile(filePath);
  } catch (error) {
    console.error("Error reading local file:", error);
    return null;
  }
}
