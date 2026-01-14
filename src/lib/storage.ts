import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "path";
import fs from "fs/promises";

// Storage configuration
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.NEXT_PUBLIC_R2_BUCKET;
const R2_ENDPOINT = process.env.NEXT_PUBLIC_R2_ENDPOINT;

// Check if R2/S3 storage is configured
const isCloudStorageConfigured = !!(
  R2_ACCESS_KEY_ID &&
  R2_SECRET_ACCESS_KEY &&
  R2_BUCKET &&
  R2_ENDPOINT
);

// S3 client for R2 (only create if configured)
let s3Client: S3Client | null = null;
if (isCloudStorageConfigured) {
  s3Client = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT!,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID!,
      secretAccessKey: R2_SECRET_ACCESS_KEY!,
    },
  });
}

// Local storage directory
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

/**
 * Get the storage path for a document
 */
function getStoragePath(
  entityType: string,
  entityId: string,
  fileName: string
): string {
  return `documents/${entityType}/${entityId}/${fileName}`;
}

/**
 * Ensure local upload directory exists
 */
async function ensureLocalUploadDir(entityType: string, entityId: string): Promise<string> {
  const dir = path.join(LOCAL_UPLOAD_DIR, entityType, entityId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Upload a file to cloud storage (R2/S3)
 */
async function uploadToCloud(
  buffer: Buffer,
  storagePath: string,
  mimeType: string
): Promise<string> {
  if (!s3Client || !R2_BUCKET) {
    throw new Error("Cloud storage is not configured");
  }

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: storagePath,
    Body: buffer,
    ContentType: mimeType,
  });

  await s3Client.send(command);

  // Return the URL
  return `${R2_ENDPOINT}/${R2_BUCKET}/${storagePath}`;
}

/**
 * Upload a file to local storage
 */
async function uploadToLocal(
  buffer: Buffer,
  entityType: string,
  entityId: string,
  fileName: string
): Promise<string> {
  const dir = await ensureLocalUploadDir(entityType, entityId);
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, buffer);

  // Return relative URL for local storage
  return `/api/documents/files/${entityType}/${entityId}/${fileName}`;
}

/**
 * Upload a document file
 * Uses cloud storage (R2) if configured, otherwise falls back to local storage
 */
export async function uploadDocument(
  file: File | Buffer,
  originalFileName: string,
  mimeType: string,
  entityType: string,
  entityId: string
): Promise<UploadResult> {
  const fileName = generateFileName(originalFileName);
  const storagePath = getStoragePath(entityType, entityId, fileName);

  // Get buffer from file
  const buffer = file instanceof File
    ? Buffer.from(await file.arrayBuffer())
    : file;

  const fileSize = buffer.length;

  try {
    let url: string;
    let storageType: "cloud" | "local";

    if (isCloudStorageConfigured) {
      url = await uploadToCloud(buffer, storagePath, mimeType);
      storageType = "cloud";
    } else {
      url = await uploadToLocal(buffer, entityType, entityId, fileName);
      storageType = "local";
    }

    return {
      url,
      fileName,
      originalFileName,
      fileSize,
      mimeType,
      storageType,
    };
  } catch (error) {
    console.error("Error uploading document:", error);
    throw new Error("Failed to upload document");
  }
}

/**
 * Delete a document file
 */
export async function deleteDocumentFile(
  fileUrl: string,
  entityType: string,
  entityId: string,
  fileName: string
): Promise<boolean> {
  try {
    // Check if it's a cloud URL
    if (fileUrl.startsWith("http")) {
      if (!s3Client || !R2_BUCKET) {
        console.warn("Cloud storage not configured, cannot delete cloud file");
        return false;
      }

      const storagePath = getStoragePath(entityType, entityId, fileName);
      const command = new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: storagePath,
      });

      await s3Client.send(command);
    } else {
      // Local file
      const filePath = path.join(LOCAL_UPLOAD_DIR, entityType, entityId, fileName);
      await fs.unlink(filePath);
    }

    return true;
  } catch (error) {
    console.error("Error deleting document file:", error);
    return false;
  }
}

/**
 * Get a signed URL for downloading a cloud file
 */
export async function getSignedDownloadUrl(
  storagePath: string,
  expiresIn: number = 3600
): Promise<string | null> {
  if (!s3Client || !R2_BUCKET) {
    return null;
  }

  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: storagePath,
    });

    return await getSignedUrl(s3Client, command, { expiresIn });
  } catch (error) {
    console.error("Error generating signed URL:", error);
    return null;
  }
}

/**
 * Read a local file
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

/**
 * Get a document from storage (cloud or local) by URL
 * Supports both cloud storage URLs and local file paths
 */
export async function getDocument(fileUrl: string): Promise<Buffer | null> {
  try {
    // Check if it's a cloud storage URL
    if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
      // Cloud storage - fetch via signed URL or direct download
      if (isCloudStorageConfigured && s3Client && R2_BUCKET) {
        // Extract the key from the URL
        // URLs look like: https://endpoint/bucket/path or just the key path
        const url = new URL(fileUrl);
        let key = url.pathname;

        // Remove leading slash and bucket name if present
        key = key.replace(/^\//, "");
        if (key.startsWith(R2_BUCKET + "/")) {
          key = key.substring(R2_BUCKET.length + 1);
        }

        const command = new GetObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
        });

        const response = await s3Client.send(command);
        if (response.Body) {
          const chunks: Uint8Array[] = [];
          for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
            chunks.push(chunk);
          }
          return Buffer.concat(chunks);
        }
      } else {
        // No cloud storage configured, try to fetch via HTTP
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return Buffer.from(await response.arrayBuffer());
      }
    } else {
      // Local file path - check if it's an absolute path or relative to uploads
      let filePath = fileUrl;

      // If it's a relative path, resolve it relative to uploads directory
      if (!path.isAbsolute(filePath)) {
        filePath = path.join(LOCAL_UPLOAD_DIR, filePath);
      }

      return await fs.readFile(filePath);
    }
  } catch (error) {
    console.error("Error getting document:", error);
    return null;
  }

  return null;
}

/**
 * Check if storage is using cloud
 */
export function isUsingCloudStorage(): boolean {
  return isCloudStorageConfigured;
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
