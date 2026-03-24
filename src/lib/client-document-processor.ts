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
import { clientDocument, client, franchisee } from "@/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { uploadDocument } from "@/lib/storage";
import { getClientParser } from "@/lib/client-parsers";
import { parseTabitFile } from "@/lib/client-parsers/tabit-parser";
import { matchFranchiseeName } from "@/lib/franchisee-matcher";
import type { ClientDocumentProcessingResult, TabitUploadSummary } from "@/lib/client-parsers/types";
import type { ClientDocument, Franchisee } from "@/db/schema";

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

// ============================================================================
// TABIT PIVOT TABLE UPLOAD
// ============================================================================

/** Input for processing a Tabit pivot table upload */
export interface ProcessTabitUploadInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  periodMonth?: number;
  periodYear?: number;
  source: "manual_upload" | "gmail_fetch";
  userId?: string;
  gmailMessageId?: string;
}

/** Result of a Tabit upload */
export interface ProcessTabitUploadResult {
  success: boolean;
  summary: TabitUploadSummary | null;
  error?: string;
}

/**
 * Process a Tabit pivot table Excel file.
 *
 * One Tabit file → multiple client_document records (one per franchisee × client pair).
 *
 * Steps:
 * 1. Parse the Excel pivot table
 * 2. Upload original file to blob storage
 * 3. Load clients with tabitColumnNames from DB → build column→clientId mapping
 * 4. Load franchisees → match branch names via fuzzy matching
 * 5. For each (franchisee × client) with non-zero amount → upsert client_document
 * 6. Return summary with created/updated counts and unmapped columns
 */
export async function processTabitUpload(
  input: ProcessTabitUploadInput
): Promise<ProcessTabitUploadResult> {
  const { buffer, fileName, mimeType, source, userId, gmailMessageId } = input;

  try {
    // Step 1: Parse the Tabit file
    const parseResult = await parseTabitFile(buffer, mimeType);

    if (!parseResult.success || !parseResult.data) {
      return {
        success: false,
        summary: null,
        error: parseResult.errors.join("; ") || "שגיאה בפענוח קובץ טאביט",
      };
    }

    const { period, branches, paymentMethods } = parseResult.data;

    // Use file-extracted period or fall back to input
    const periodMonth = period?.month ?? input.periodMonth;
    const periodYear = period?.year ?? input.periodYear;

    if (!periodMonth || !periodYear) {
      return {
        success: false,
        summary: null,
        error: "לא ניתן לזהות תקופה מהקובץ ולא סופקו חודש/שנה",
      };
    }

    // Step 2: Upload original file once
    const uploadResult = await uploadDocument(
      buffer,
      fileName,
      mimeType,
      "tabit",
      `pivot-${periodYear}-${String(periodMonth).padStart(2, "0")}`
    );

    // Step 3: Load clients with tabitColumnNames and build column→client mapping
    const clientsWithColumns = await database
      .select({
        id: client.id,
        code: client.code,
        tabitColumnNames: client.tabitColumnNames,
      })
      .from(client)
      .where(
        and(eq(client.isActive, true), isNotNull(client.tabitColumnNames))
      );

    // Map: column name (lowercase) → { clientId, clientCode }
    // Case-insensitive matching since Tabit column names vary (e.g., "Haat" vs "HAAT")
    const columnToClient = new Map<
      string,
      { clientId: string; clientCode: string | null }
    >();
    for (const c of clientsWithColumns) {
      const columns = c.tabitColumnNames as string[] | null;
      if (!columns) continue;
      for (const colName of columns) {
        columnToClient.set(colName.toLowerCase(), { clientId: c.id, clientCode: c.code });
      }
    }

    // Step 4: Load franchisees for matching
    const allFranchisees = await database
      .select()
      .from(franchisee)
      .where(eq(franchisee.isActive, true));

    // Step 5: Process each branch row
    let documentsCreated = 0;
    let documentsUpdated = 0;
    let skippedZeroAmounts = 0;
    const unmatchedBranches: string[] = [];
    const unmappedColumnsSet = new Set<string>();

    for (const branch of branches) {
      // Match branch name to franchisee
      const matchResult = matchFranchiseeName(
        branch.branchName,
        allFranchisees as Franchisee[]
      );

      if (!matchResult.matchedFranchisee) {
        unmatchedBranches.push(branch.branchName);
        continue;
      }

      const franchiseeId = matchResult.matchedFranchisee.id;

      // Group amounts by client (sum columns that map to the same client)
      const clientAmounts = new Map<
        string,
        { clientId: string; clientCode: string | null; amount: number }
      >();

      for (const [colName, amount] of Object.entries(branch.amounts)) {
        const mapping = columnToClient.get(colName.toLowerCase());
        if (!mapping) {
          // Column not mapped to any client
          if (amount !== 0) {
            unmappedColumnsSet.add(colName);
          }
          continue;
        }

        const existing = clientAmounts.get(mapping.clientId);
        if (existing) {
          existing.amount += amount;
        } else {
          clientAmounts.set(mapping.clientId, {
            clientId: mapping.clientId,
            clientCode: mapping.clientCode,
            amount,
          });
        }
      }

      // Create/update a client_document for each client with non-zero amount
      for (const [clientId, { amount }] of clientAmounts) {
        if (amount === 0) {
          skippedZeroAmounts++;
          continue;
        }

        // Check for existing document
        const existingDoc = await database
          .select({ id: clientDocument.id })
          .from(clientDocument)
          .where(
            and(
              eq(clientDocument.franchiseeId, franchiseeId),
              eq(clientDocument.clientId, clientId),
              eq(clientDocument.periodMonth, periodMonth),
              eq(clientDocument.periodYear, periodYear),
              eq(clientDocument.documentType, "tabit_report")
            )
          )
          .limit(1);

        const docData = {
          clientId,
          franchiseeId,
          documentType: "tabit_report" as const,
          source,
          originalFileName: fileName,
          fileUrl: uploadResult.url,
          fileSize: uploadResult.fileSize,
          mimeType,
          periodMonth,
          periodYear,
          processingStatus: "auto_approved" as const,
          processingResult: {
            success: true,
            branchName: branch.branchName,
            matchConfidence: matchResult.confidence,
            matchType: matchResult.matchType,
          } as unknown as Record<string, unknown>,
          totalAmount: amount.toString(),
          commissionAmount: null,
          commissionRate: null,
          netAmount: null,
          gmailMessageId: gmailMessageId ?? null,
          createdBy: userId ?? null,
          updatedAt: new Date(),
        };

        if (existingDoc.length > 0) {
          await database
            .update(clientDocument)
            .set(docData)
            .where(eq(clientDocument.id, existingDoc[0].id));
          documentsUpdated++;
        } else {
          await database.insert(clientDocument).values(docData);
          documentsCreated++;
        }
      }
    }

    const summary: TabitUploadSummary = {
      documentsCreated,
      documentsUpdated,
      unmatchedBranches,
      unmappedColumns: Array.from(unmappedColumnsSet),
      skippedZeroAmounts,
      period: { month: periodMonth, year: periodYear },
      fileUrl: uploadResult.url,
    };

    return { success: true, summary };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error("Error processing Tabit upload:", errorMessage);

    return {
      success: false,
      summary: null,
      error: `שגיאה בעיבוד קובץ טאביט: ${errorMessage}`,
    };
  }
}
