/**
 * Unified client document processing pipeline.
 *
 * CRITICAL: This is the SINGLE entry point for processing both email-fetched
 * and manually-uploaded documents. Both paths MUST use this function to ensure
 * identical processing logic.
 *
 * Flow:
 *   [Gmail Fetch] ──→ buffer + metadata ──┐
 *                                          ├──→ processClientDocument()
 *   [Manual Upload] ──→ buffer + metadata ─┘
 */

import { database } from "@/db";
import { clientDocument } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { uploadDocument } from "@/lib/storage";
import { getClientParser } from "@/lib/client-parsers";
import type { ClientDocumentProcessingResult } from "@/lib/client-parsers/types";
import type { ClientDocument } from "@/db/schema";

/** Input for processing a client document */
export interface ProcessClientDocumentInput {
  /** Raw file buffer */
  buffer: Buffer;
  /** Original file name */
  fileName: string;
  /** MIME type of the file */
  mimeType: string;
  /** Client ID (null for Tabit reports) */
  clientId: string | null;
  /** Client code for parser routing (e.g. "CIBUS", "TABIT") */
  parserCode: string;
  /** Franchisee ID */
  franchiseeId: string;
  /** Period month (1-12) */
  periodMonth: number;
  /** Period year */
  periodYear: number;
  /** Document type */
  documentType: "client_report" | "tabit_report";
  /** How the document was received */
  source: "manual_upload" | "gmail_fetch";
  /** Gmail message ID for dedup (only for gmail_fetch source) */
  gmailMessageId?: string;
  /** User who triggered the processing */
  userId?: string;
}

/** Result of document processing */
export interface ProcessClientDocumentResult {
  success: boolean;
  document: ClientDocument | null;
  processingResult: ClientDocumentProcessingResult | null;
  error?: string;
  /** True if document was skipped because it already exists */
  skippedDuplicate?: boolean;
}

/**
 * Process a client document through the unified pipeline.
 *
 * Steps:
 * 1. Dedup check (by gmailMessageId or client+franchisee+period)
 * 2. Upload file to Vercel Blob
 * 3. Route to appropriate parser
 * 4. Parse and extract data
 * 5. Store client_document record with results
 */
export async function processClientDocument(
  input: ProcessClientDocumentInput
): Promise<ProcessClientDocumentResult> {
  const {
    buffer,
    fileName,
    mimeType,
    clientId,
    parserCode,
    franchiseeId,
    periodMonth,
    periodYear,
    documentType,
    source,
    gmailMessageId,
    userId,
  } = input;

  try {
    // Step 1: Dedup check
    if (gmailMessageId) {
      const existing = await database
        .select({ id: clientDocument.id })
        .from(clientDocument)
        .where(eq(clientDocument.gmailMessageId, gmailMessageId))
        .limit(1);

      if (existing.length > 0) {
        return {
          success: true,
          document: null,
          processingResult: null,
          skippedDuplicate: true,
        };
      }
    }

    // Check for existing document for same client+franchisee+period
    // For manual uploads, we replace the existing document
    const existingConditions = [
      eq(clientDocument.franchiseeId, franchiseeId),
      eq(clientDocument.periodMonth, periodMonth),
      eq(clientDocument.periodYear, periodYear),
      eq(clientDocument.documentType, documentType),
    ];
    if (clientId) {
      existingConditions.push(eq(clientDocument.clientId, clientId));
    }

    const existingDoc = await database
      .select({ id: clientDocument.id })
      .from(clientDocument)
      .where(and(...existingConditions))
      .limit(1);

    // Step 2: Upload file to Vercel Blob
    const entityType = documentType === "tabit_report" ? "tabit" : "client";
    const entityId = clientId ?? "tabit";

    const uploadResult = await uploadDocument(
      buffer,
      fileName,
      mimeType,
      entityType,
      entityId
    );

    // Step 3: Route to parser
    const parser = getClientParser(parserCode);
    let processingResult: ClientDocumentProcessingResult;

    if (parser) {
      // Step 4: Parse
      processingResult = await parser(buffer, mimeType);
    } else {
      // No parser available - store document without parsing
      processingResult = {
        success: true,
        data: null,
        errors: [],
        warnings: [`אין פרסר מוגדר עבור קוד "${parserCode}" - הקובץ נשמר ללא עיבוד`],
      };
    }

    // Determine processing status based on result
    const processingStatus = !processingResult.success
      ? ("needs_review" as const)
      : processingResult.data
        ? ("auto_approved" as const)
        : ("pending" as const);

    // Step 5: Store in DB
    const docData = {
      clientId,
      franchiseeId,
      documentType,
      source,
      originalFileName: fileName,
      fileUrl: uploadResult.url,
      fileSize: uploadResult.fileSize,
      mimeType,
      periodMonth,
      periodYear,
      processingStatus,
      processingResult: processingResult as unknown as Record<string, unknown>,
      totalAmount: processingResult.data?.totalAmount?.toString() ?? null,
      commissionAmount: processingResult.data?.commissionAmount?.toString() ?? null,
      commissionRate: processingResult.data?.commissionRate?.toString() ?? null,
      netAmount: processingResult.data?.netAmount?.toString() ?? null,
      gmailMessageId: gmailMessageId ?? null,
      createdBy: userId ?? null,
      updatedAt: new Date(),
    };

    let document: ClientDocument;

    if (existingDoc.length > 0) {
      // Update existing document (replace)
      const [updated] = await database
        .update(clientDocument)
        .set(docData)
        .where(eq(clientDocument.id, existingDoc[0].id))
        .returning();
      document = updated;
    } else {
      // Insert new document
      const [inserted] = await database
        .insert(clientDocument)
        .values(docData)
        .returning();
      document = inserted;
    }

    return {
      success: true,
      document,
      processingResult,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error("Error processing client document:", errorMessage);

    return {
      success: false,
      document: null,
      processingResult: null,
      error: `שגיאה בעיבוד מסמך: ${errorMessage}`,
    };
  }
}
