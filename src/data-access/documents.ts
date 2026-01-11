import { database } from "@/db";
import {
  document,
  user,
  type Document,
  type CreateDocumentData,
  type UpdateDocumentData,
  type DocumentStatus,
} from "@/db/schema";
import { eq, desc, and, or } from "drizzle-orm";

// Document types supported by the system
export type DocumentType = "agreement" | "correspondence" | "invoice" | "other";

// Entity types that can have documents
export type DocumentEntityType = "supplier" | "franchisee" | "brand";

// Extended document type with uploader info
export type DocumentWithUploader = Document & {
  uploaderName?: string | null;
  uploaderEmail?: string | null;
};

/**
 * Get all documents for a specific entity
 */
export async function getDocumentsByEntity(
  entityType: DocumentEntityType,
  entityId: string
): Promise<DocumentWithUploader[]> {
  const results = await database
    .select({
      id: document.id,
      name: document.name,
      description: document.description,
      documentType: document.documentType,
      status: document.status,
      entityType: document.entityType,
      entityId: document.entityId,
      fileUrl: document.fileUrl,
      fileName: document.fileName,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      version: document.version,
      effectiveDate: document.effectiveDate,
      expirationDate: document.expirationDate,
      metadata: document.metadata,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      createdBy: document.createdBy,
      uploaderName: user.name,
      uploaderEmail: user.email,
    })
    .from(document)
    .leftJoin(user, eq(document.createdBy, user.id))
    .where(
      and(
        eq(document.entityType, entityType),
        eq(document.entityId, entityId)
      )
    )
    .orderBy(desc(document.createdAt));

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    documentType: row.documentType,
    status: row.status,
    entityType: row.entityType,
    entityId: row.entityId,
    fileUrl: row.fileUrl,
    fileName: row.fileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    version: row.version,
    effectiveDate: row.effectiveDate,
    expirationDate: row.expirationDate,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    uploaderName: row.uploaderName,
    uploaderEmail: row.uploaderEmail,
  }));
}

/**
 * Get a single document by ID
 */
export async function getDocumentById(
  id: string
): Promise<DocumentWithUploader | null> {
  const results = await database
    .select({
      id: document.id,
      name: document.name,
      description: document.description,
      documentType: document.documentType,
      status: document.status,
      entityType: document.entityType,
      entityId: document.entityId,
      fileUrl: document.fileUrl,
      fileName: document.fileName,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      version: document.version,
      effectiveDate: document.effectiveDate,
      expirationDate: document.expirationDate,
      metadata: document.metadata,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      createdBy: document.createdBy,
      uploaderName: user.name,
      uploaderEmail: user.email,
    })
    .from(document)
    .leftJoin(user, eq(document.createdBy, user.id))
    .where(eq(document.id, id))
    .limit(1);

  if (results.length === 0) return null;

  const row = results[0];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    documentType: row.documentType,
    status: row.status,
    entityType: row.entityType,
    entityId: row.entityId,
    fileUrl: row.fileUrl,
    fileName: row.fileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    version: row.version,
    effectiveDate: row.effectiveDate,
    expirationDate: row.expirationDate,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    uploaderName: row.uploaderName,
    uploaderEmail: row.uploaderEmail,
  };
}

/**
 * Create a new document
 */
export async function createDocument(
  data: CreateDocumentData
): Promise<Document> {
  const [newDocument] = (await database
    .insert(document)
    .values(data)
    .returning()) as unknown as Document[];
  return newDocument;
}

/**
 * Update an existing document
 */
export async function updateDocument(
  id: string,
  data: UpdateDocumentData
): Promise<Document | null> {
  const results = (await database
    .update(document)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(document.id, id))
    .returning()) as unknown as Document[];
  return results[0] || null;
}

/**
 * Delete a document
 */
export async function deleteDocument(id: string): Promise<boolean> {
  const result = await database.delete(document).where(eq(document.id, id));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Get document count by entity
 */
export async function getDocumentCountByEntity(
  entityType: DocumentEntityType,
  entityId: string
): Promise<number> {
  const results = await database
    .select()
    .from(document)
    .where(
      and(
        eq(document.entityType, entityType),
        eq(document.entityId, entityId)
      )
    );
  return results.length;
}

/**
 * Get documents by type for an entity
 */
export async function getDocumentsByType(
  entityType: DocumentEntityType,
  entityId: string,
  documentType: DocumentType
): Promise<DocumentWithUploader[]> {
  const results = await database
    .select({
      id: document.id,
      name: document.name,
      description: document.description,
      documentType: document.documentType,
      status: document.status,
      entityType: document.entityType,
      entityId: document.entityId,
      fileUrl: document.fileUrl,
      fileName: document.fileName,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      version: document.version,
      effectiveDate: document.effectiveDate,
      expirationDate: document.expirationDate,
      metadata: document.metadata,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      createdBy: document.createdBy,
      uploaderName: user.name,
      uploaderEmail: user.email,
    })
    .from(document)
    .leftJoin(user, eq(document.createdBy, user.id))
    .where(
      and(
        eq(document.entityType, entityType),
        eq(document.entityId, entityId),
        eq(document.documentType, documentType)
      )
    )
    .orderBy(desc(document.createdAt));

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    documentType: row.documentType,
    status: row.status,
    entityType: row.entityType,
    entityId: row.entityId,
    fileUrl: row.fileUrl,
    fileName: row.fileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    version: row.version,
    effectiveDate: row.effectiveDate,
    expirationDate: row.expirationDate,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    uploaderName: row.uploaderName,
    uploaderEmail: row.uploaderEmail,
  }));
}

/**
 * Update document status
 */
export async function updateDocumentStatus(
  id: string,
  status: DocumentStatus
): Promise<Document | null> {
  const results = (await database
    .update(document)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(document.id, id))
    .returning()) as unknown as Document[];
  return results[0] || null;
}

/**
 * Validate document type
 */
export function isValidDocumentType(type: string): type is DocumentType {
  return ["agreement", "correspondence", "invoice", "other"].includes(type);
}

/**
 * Get document type label (for display)
 */
export function getDocumentTypeLabel(type: DocumentType): string {
  const labels: Record<DocumentType, string> = {
    agreement: "Agreement",
    correspondence: "Correspondence",
    invoice: "Invoice",
    other: "Other",
  };
  return labels[type] || type;
}

/**
 * Get document type label in Hebrew (for display)
 */
export function getDocumentTypeLabelHe(type: DocumentType): string {
  const labels: Record<DocumentType, string> = {
    agreement: "הסכם",
    correspondence: "התכתבות",
    invoice: "חשבונית",
    other: "אחר",
  };
  return labels[type] || type;
}
