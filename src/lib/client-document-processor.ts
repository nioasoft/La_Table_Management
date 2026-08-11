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
import {
  clientDocument,
  clientDocumentPart,
  client,
  franchisee,
} from "@/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { uploadDocument } from "@/lib/storage";
import {
  getClientParser,
  getInvoiceParser,
  getSectionExtractor,
} from "@/lib/client-parsers";
import { parseTabitFile } from "@/lib/client-parsers/tabit-parser";
import { parseHeverFile } from "@/lib/client-parsers/hever-parser";
import { matchFranchiseeName } from "@/lib/franchisee-matcher";
import {
  extractCoveragePeriod,
  periodsOverlap,
  type CoveragePeriod,
} from "@/lib/coverage-period";
import {
  upsertOccasionalClientFromTabit,
  upsertOccasionalClientDocument,
} from "@/data-access/occasional-clients";
import type {
  ClientDocumentProcessingResult,
  ClientParsedLineItem,
  TabitUploadSummary,
} from "@/lib/client-parsers/types";
import type { ClientDocument, Franchisee } from "@/db/schema";

/**
 * Resolve the invoice number for a client document. Priority chain:
 *   1. Value the parser bubbled up on `data.invoiceNumber`.
 *   2. Regex on the original file name — matches ezcount filenames like
 *      `Tax_Invoice_10058.pdf` (MISHLOCHA / HAAT manual uploads).
 *   3. Regex on any line-item description — catches cases where the parser
 *      built the description using the extracted number but didn't set the
 *      top-level field (observed on WOLT PDFs and Mishlocha/HAAT gmail-fetch
 *      ezcount PDFs).
 *
 * Returns null when no source matches. CIBUS / TENBIS / HEVER uploads never
 * carry an invoice number — they'll fall through to null, which is fine; the
 * Hashavshevet journal-entries export ignores invoice# for those codes.
 */
function resolveInvoiceNumber(
  parserValue: string | null | undefined,
  fileName: string,
  lineItems: ReadonlyArray<ClientParsedLineItem> | undefined
): string | null {
  if (parserValue) return parserValue;

  const fromFilename = fileName.match(/Tax[_-]?Invoice[_-]?(\d+)/i)?.[1];
  if (fromFilename) return fromFilename;

  if (lineItems) {
    for (const item of lineItems) {
      if (!item.description) continue;
      const match = item.description.match(
        /חשבונית\s+(?:משלוחה|וולט)\s+(?:מס['׳]?\s*)?(\d{3,})/
      );
      if (match) return match[1];
    }
  }

  return null;
}

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
  documentType: "client_report" | "tabit_report" | "commission_invoice";
  /** How the document was received */
  source: "manual_upload" | "gmail_fetch";
  /** Gmail message ID for dedup (only for gmail_fetch source) */
  gmailMessageId?: string;
  /** User who triggered the processing */
  userId?: string;
  /**
   * Allow a gmail_fetch document to REPLACE an existing document that
   * originated from a different email. Default false: an unattended
   * webhook must never silently destroy a previously-ingested document
   * (the May 2026 Vini/Natanzon incident collapsed 4 different HAAT
   * documents into one slot this way). Set true only on admin-driven
   * paths (inbound-review confirm) where a human explicitly chose the
   * target franchisee/type.
   */
  allowReplace?: boolean;
}

/** Result of document processing */
export interface ProcessClientDocumentResult {
  success: boolean;
  document: ClientDocument | null;
  processingResult: ClientDocumentProcessingResult | null;
  error?: string;
  /** True if document was skipped because it already exists */
  skippedDuplicate?: boolean;
  /**
   * True when the write was refused because a document for the same
   * (client, franchisee, period, type) slot already exists and came from
   * a DIFFERENT email. The caller should surface this for manual review —
   * in practice it usually means the new document belongs to a different
   * franchisee (two businesses sharing one legal entity).
   */
  skippedConflict?: boolean;
  /** The occupying document, when skippedConflict is true. */
  conflictWith?: {
    documentId: string;
    gmailMessageId: string | null;
    fileName: string;
  };
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
    allowReplace = false,
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

    // Step 3: Route to parser (invoice parsers for commission_invoice, report parsers otherwise)
    const parser = documentType === "commission_invoice"
      ? getInvoiceParser(parserCode)
      : getClientParser(parserCode);
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

    // Parser-level rejection: e.g. 10bis "הודעת תשלום" PDFs that share an
    // inbound channel with real monthly reports. Skipping here prevents
    // both the spurious needs_review row AND the dedup-replace from
    // overwriting a valid prior report for the same franchisee+period.
    if (processingResult.skipPersist) {
      console.log(
        `[client-document-processor] skipping persist for "${fileName}": ${processingResult.warnings.join(" | ") || processingResult.errors.join(" | ")}`
      );
      return {
        success: true,
        document: null,
        processingResult,
        skippedDuplicate: false,
      };
    }

    // Step 4b: Use parser-extracted period if available (same pattern as Tabit handler).
    // Client documents arrive ~1 month after the period they cover, so the parser's
    // extracted period is more accurate than the user-selected input period.
    const finalPeriodMonth = processingResult.data?.periodMonth ?? periodMonth;
    const finalPeriodYear = processingResult.data?.periodYear ?? periodYear;

    // Step 4c: Dedup check — runs AFTER parsing so it uses the corrected period.
    // For manual uploads, we replace the existing document.
    const existingConditions = [
      eq(clientDocument.franchiseeId, franchiseeId),
      eq(clientDocument.periodMonth, finalPeriodMonth),
      eq(clientDocument.periodYear, finalPeriodYear),
      eq(clientDocument.documentType, documentType),
    ];
    if (clientId) {
      existingConditions.push(eq(clientDocument.clientId, clientId));
    }

    const existingDoc = await database
      .select({
        id: clientDocument.id,
        gmailMessageId: clientDocument.gmailMessageId,
        originalFileName: clientDocument.originalFileName,
        invoiceNumber: clientDocument.invoiceNumber,
        totalAmount: clientDocument.totalAmount,
        commissionAmount: clientDocument.commissionAmount,
        fileUrl: clientDocument.fileUrl,
      })
      .from(clientDocument)
      .where(and(...existingConditions))
      .limit(1);

    const resolvedInvoiceNumber = resolveInvoiceNumber(
      processingResult.data?.invoiceNumber,
      fileName,
      processingResult.data?.lineItems
    );

    // Cross-channel duplicate: the SAME invoice can arrive via two routes
    // (ezcount "[העתק]" copy on the Mishloha channel AND the platform's own
    // relay, e.g. "EasyCount Invoice for HAAT"). When the occupying document
    // carries the same invoice number and the same total, this is not a
    // conflict — skip silently like a re-delivery.
    if (
      existingDoc.length > 0 &&
      source === "gmail_fetch" &&
      existingDoc[0].gmailMessageId !== (gmailMessageId ?? null) &&
      resolvedInvoiceNumber !== null &&
      existingDoc[0].invoiceNumber === resolvedInvoiceNumber &&
      existingDoc[0].totalAmount !== null &&
      processingResult.data?.totalAmount !== undefined &&
      Math.abs(
        parseFloat(existingDoc[0].totalAmount) -
          processingResult.data.totalAmount
      ) < 0.01
    ) {
      console.log(
        `[client-document-processor] cross-channel duplicate of invoice ${resolvedInvoiceNumber} (existing doc ${existingDoc[0].id}) — skipping`
      );
      return {
        success: true,
        document: null,
        processingResult,
        skippedDuplicate: true,
      };
    }

    // Split period: a SECOND file covering a DIFFERENT part of the same month
    // is not a conflict, it is the rest of the month. Try to merge before the
    // overwrite guard below refuses it.
    if (
      existingDoc.length > 0 &&
      source === "gmail_fetch" &&
      !allowReplace &&
      existingDoc[0].gmailMessageId !== (gmailMessageId ?? null)
    ) {
      const merged = await tryMergeAsPart({
        existing: existingDoc[0],
        fileName,
        fileUrl: uploadResult.url,
        totalAmount: processingResult.data?.totalAmount ?? null,
        commissionAmount: processingResult.data?.commissionAmount ?? null,
        gmailMessageId: gmailMessageId ?? null,
      });
      if (merged) {
        console.log(
          `[client-document-processor] split period: "${fileName}" merged into document ${existingDoc[0].id} — month total is now ${merged.totalAmount}`,
        );
        return {
          success: true,
          document: merged,
          processingResult,
        };
      }
    }

    // Overwrite guard: an unattended gmail_fetch must never silently
    // replace a document that came from a DIFFERENT email (or from a
    // manual upload). May 2026 incident: two HAAT businesses (VINNI /
    // Natanzon Burger) share one legal entity, so 4 different HAAT
    // documents resolved to the same (client, franchisee, period, type)
    // slot and each new email destroyed the previous document with no
    // warning. Refuse the write and let the caller park it in the
    // inbound review queue — the admin decides whether it replaces the
    // existing doc or belongs to another franchisee.
    if (
      existingDoc.length > 0 &&
      source === "gmail_fetch" &&
      !allowReplace &&
      existingDoc[0].gmailMessageId !== (gmailMessageId ?? null)
    ) {
      console.warn(
        `[client-document-processor] CONFLICT: refusing to overwrite document ${existingDoc[0].id} ("${existingDoc[0].originalFileName}", email=${existingDoc[0].gmailMessageId ?? "manual"}) with "${fileName}" (email=${gmailMessageId ?? "?"}) — same slot, different email`
      );
      return {
        success: false,
        document: null,
        processingResult,
        skippedConflict: true,
        conflictWith: {
          documentId: existingDoc[0].id,
          gmailMessageId: existingDoc[0].gmailMessageId,
          fileName: existingDoc[0].originalFileName,
        },
        error:
          `קיים כבר מסמך לזכיין/תקופה/סוג זה ממקור אחר ("${existingDoc[0].originalFileName}"). ` +
          `המסמך החדש ("${fileName}") לא נשמר אוטומטית כדי לא לדרוס נתונים — ` +
          `ייתכן שהוא שייך לזכיין אחר (למשל שני עסקים תחת אותה ישות משפטית). יש לשייך ידנית.`,
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
      periodMonth: finalPeriodMonth,
      periodYear: finalPeriodYear,
      processingStatus,
      processingResult: processingResult as unknown as Record<string, unknown>,
      totalAmount: processingResult.data?.totalAmount?.toString() ?? null,
      commissionAmount: processingResult.data?.commissionAmount?.toString() ?? null,
      commissionRate: processingResult.data?.commissionRate?.toString() ?? null,
      netAmount: processingResult.data?.netAmount?.toString() ?? null,
      invoiceNumber: resolvedInvoiceNumber,
      allocationNumber: processingResult.data?.allocationNumber ?? null,
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
    // Occasional-client amounts, grouped by (columnName → franchiseeId → summed amount).
    // We register each occasional client name once (outside the branch loop) and
    // persist per-(franchisee, period) amounts afterwards.
    const occasionalAmounts = new Map<
      string, // tabit column name (display)
      Map<string, number> // franchiseeId → amount
    >();

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
          // Column not mapped to any known client → treat as occasional client
          if (amount !== 0) {
            unmappedColumnsSet.add(colName);
            let perFranchisee = occasionalAmounts.get(colName);
            if (!perFranchisee) {
              perFranchisee = new Map<string, number>();
              occasionalAmounts.set(colName, perFranchisee);
            }
            perFranchisee.set(
              franchiseeId,
              (perFranchisee.get(franchiseeId) ?? 0) + amount
            );
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

    // Persist occasional clients and their per-franchisee amounts. Each unique
    // column name becomes a registry row; each (column, franchisee, period)
    // tuple becomes a transaction row. Failures here don't abort the upload —
    // we just log them, since the main client_document writes already succeeded.
    let occasionalClientsCreated = 0;
    let occasionalDocumentsCreated = 0;
    for (const [columnName, perFranchisee] of occasionalAmounts.entries()) {
      try {
        const occClient = await upsertOccasionalClientFromTabit({
          tabitColumnName: columnName,
          firstSeenPeriodMonth: periodMonth,
          firstSeenPeriodYear: periodYear,
          createdBy: userId ?? null,
        });
        occasionalClientsCreated++;
        for (const [franchiseeId, amount] of perFranchisee.entries()) {
          await upsertOccasionalClientDocument({
            occasionalClientId: occClient.id,
            franchiseeId,
            periodMonth,
            periodYear,
            totalAmount: amount,
            sourceTabitFileUrl: uploadResult.url,
            sourceTabitFileName: fileName,
          });
          occasionalDocumentsCreated++;
        }
      } catch (err) {
        console.error(
          `Failed to persist occasional client "${columnName}":`,
          err instanceof Error ? err.message : err
        );
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
      occasionalClientsCreated,
      occasionalDocumentsCreated,
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

// ============================================================================
// HEVER (חבר) UPLOAD — one file → multiple client_document records
// ============================================================================

export interface ProcessHeverUploadInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  clientId: string;
  periodMonth?: number;
  periodYear?: number;
  source: "manual_upload" | "gmail_fetch";
  userId?: string;
}

export interface ProcessHeverUploadResult {
  success: boolean;
  summary: {
    documentsCreated: number;
    documentsUpdated: number;
    unmatchedBranches: string[];
    skippedZeroAmounts: number;
    period: { month: number; year: number } | null;
    fileUrl: string;
  } | null;
  error?: string;
}

/**
 * Process a Hever (חבר) Excel report.
 *
 * One Hever file → multiple client_document records (one per franchisee).
 * Similar to processTabitUpload but all records share the same client (HEVER).
 */
export async function processHeverUpload(
  input: ProcessHeverUploadInput
): Promise<ProcessHeverUploadResult> {
  const { buffer, fileName, mimeType, clientId, source, userId } = input;

  try {
    // Step 1: Parse the Hever file
    const parseResult = parseHeverFile(buffer);

    if (!parseResult.success || parseResult.businesses.length === 0) {
      return {
        success: false,
        summary: null,
        error: parseResult.errors.join("; ") || "שגיאה בפענוח קובץ חבר",
      };
    }

    // Use file-extracted period or fall back to input
    const periodMonth = parseResult.period?.month ?? input.periodMonth;
    const periodYear = parseResult.period?.year ?? input.periodYear;

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
      "client",
      `hever-${periodYear}-${String(periodMonth).padStart(2, "0")}`
    );

    // Step 3: Load franchisees for matching
    const allFranchisees = await database
      .select()
      .from(franchisee)
      .where(eq(franchisee.isActive, true));

    // Step 4: Match businesses to franchisees and AGGREGATE per franchisee
    // Multiple Hever businesses can map to the same franchisee
    // (e.g., "קינג קונג ביג בע"מ" + "קינג קונג ביג" → same franchisee)
    const unmatchedBranches: string[] = [];
    const franchiseeAgg = new Map<
      string,
      { amount: number; count: number; businessNames: string[] }
    >();

    for (const biz of parseResult.businesses) {
      if (biz.totalAmount === 0) continue;

      const matchResult = matchFranchiseeName(
        biz.businessName,
        allFranchisees as Franchisee[]
      );

      if (!matchResult.matchedFranchisee) {
        unmatchedBranches.push(biz.businessName);
        continue;
      }

      const fId = matchResult.matchedFranchisee.id;
      const existing = franchiseeAgg.get(fId);
      if (existing) {
        existing.amount += biz.totalAmount;
        existing.count += biz.transactionCount;
        existing.businessNames.push(biz.businessName);
      } else {
        franchiseeAgg.set(fId, {
          amount: biz.totalAmount,
          count: biz.transactionCount,
          businessNames: [biz.businessName],
        });
      }
    }

    // Step 5: Upsert one document per franchisee (with aggregated amounts)
    let documentsCreated = 0;
    let documentsUpdated = 0;
    const skippedZeroAmounts = 0;

    for (const [franchiseeId, agg] of franchiseeAgg) {
      const totalAmount = Math.round(agg.amount * 100) / 100;

      const existingDoc = await database
        .select({ id: clientDocument.id })
        .from(clientDocument)
        .where(
          and(
            eq(clientDocument.franchiseeId, franchiseeId),
            eq(clientDocument.clientId, clientId),
            eq(clientDocument.periodMonth, periodMonth),
            eq(clientDocument.periodYear, periodYear),
            eq(clientDocument.documentType, "client_report")
          )
        )
        .limit(1);

      const docData = {
        clientId,
        franchiseeId,
        documentType: "client_report" as const,
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
          data: {
            franchiseeName: agg.businessNames.join(" + "),
            totalAmount,
            commissionAmount: 0,
            commissionRate: 0,
            netAmount: totalAmount,
            transactionCount: agg.count,
          },
          errors: [],
          warnings: [],
        } as unknown as Record<string, unknown>,
        totalAmount: totalAmount.toString(),
        commissionAmount: "0",
        commissionRate: null,
        netAmount: totalAmount.toString(),
        gmailMessageId: null,
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

    return {
      success: true,
      summary: {
        documentsCreated,
        documentsUpdated,
        unmatchedBranches,
        skippedZeroAmounts,
        period: { month: periodMonth, year: periodYear },
        fileUrl: uploadResult.url,
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error("Error processing Hever upload:", errorMessage);

    return {
      success: false,
      summary: null,
      error: `שגיאה בעיבוד קובץ חבר: ${errorMessage}`,
    };
  }
}


/** Input for processing a multi-tenant client report */
export interface ProcessMultiTenantReportInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  clientId: string;
  /** Client code used to look up the section extractor (e.g. "TENBIS"). */
  parserCode: string;
  periodMonth: number;
  periodYear: number;
  /** Active franchisees, for name matching. */
  franchisees: Franchisee[];
  source: "gmail_fetch" | "manual_upload";
  gmailMessageId?: string;
}

export interface ProcessMultiTenantReportResult {
  /**
   * False when this file is NOT multi-tenant — the client has no section
   * extractor, or the extractor found fewer than two tenants. The caller
   * must then run its ordinary single-franchisee path. Nothing was written.
   */
  handled: boolean;
  documentsWritten: number;
  /** Section names that matched no franchisee; nothing was written for these. */
  unmatched: string[];
  matched: Array<{ franchiseeName: string; totalAmount: number }>;
  errors: string[];
}

/**
 * Process a file whose contents belong to SEVERAL franchisees.
 *
 * `processClientDocument` can only ever write one franchisee, because the
 * caller resolves the franchisee before calling it. A multi-tenant file has
 * no single answer, so before July 2026 the 10bis parser just picked the last
 * restaurant it saw and filed the entity's whole total onto that branch —
 * ₪30,132 landed on נתנזון, 169.9% above its Tabit figure, while ויני got no
 * report at all. Nothing failed and nothing was logged.
 *
 * This is the same shape processTabitUpload and processHeverUpload already
 * use for their multi-franchisee files: match each tenant name to a
 * franchisee, then upsert one document per franchisee. Franchisee resolution
 * happens HERE, from the document's own section names — callers must NOT
 * pre-resolve a franchisee and must not call resolveFranchisee first, since
 * there is no single correct answer for the file as a whole.
 *
 * `handled: false` means "not a multi-tenant file, nothing written" — the
 * caller falls through to its normal path. That is the common case: this
 * runs on every TENBIS report and only fires for shared legal entities.
 *
 * Unmatched sections are reported, never guessed. A section whose name
 * matches no franchisee is money we cannot attribute; writing it to a
 * best-guess branch is how the incident above happened in the first place.
 */
export async function processMultiTenantReport(
  input: ProcessMultiTenantReportInput,
): Promise<ProcessMultiTenantReportResult> {
  const {
    buffer,
    fileName,
    mimeType,
    clientId,
    parserCode,
    periodMonth,
    periodYear,
    franchisees,
    source,
    gmailMessageId,
  } = input;

  const idle: ProcessMultiTenantReportResult = {
    handled: false,
    documentsWritten: 0,
    unmatched: [],
    matched: [],
    errors: [],
  };

  const extractor = getSectionExtractor(parserCode);
  if (!extractor) return idle;

  let sections;
  try {
    sections = await extractor(buffer);
  } catch (error) {
    // A broken extractor must never swallow a file. Fall through to the
    // single-franchisee path, which is what ran before this existed.
    console.warn(
      `[multi-tenant] ${parserCode} section extraction failed for "${fileName}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return idle;
  }

  if (sections.length < 2) return idle;

  console.log(
    `[multi-tenant] ${parserCode} "${fileName}" holds ${sections.length} tenants: ${sections
      .map((s) => `${s.name}=${s.totalAmount}`)
      .join(", ")}`,
  );

  const uploadResult = await uploadDocument(
    buffer,
    fileName,
    mimeType,
    "client",
    clientId,
  );

  const result: ProcessMultiTenantReportResult = {
    handled: true,
    documentsWritten: 0,
    unmatched: [],
    matched: [],
    errors: [],
  };

  for (const section of sections) {
    const match = matchFranchiseeName(section.name, franchisees);
    if (!match.matchedFranchisee) {
      result.unmatched.push(section.name);
      continue;
    }

    const franchiseeId = match.matchedFranchisee.id;
    const [existing] = await database
      .select({ id: clientDocument.id })
      .from(clientDocument)
      .where(
        and(
          eq(clientDocument.clientId, clientId),
          eq(clientDocument.franchiseeId, franchiseeId),
          eq(clientDocument.periodMonth, periodMonth),
          eq(clientDocument.periodYear, periodYear),
          eq(clientDocument.documentType, "client_report"),
        ),
      )
      .limit(1);

    const commissionRate =
      section.totalAmount > 0
        ? Math.round((section.commissionAmount / section.totalAmount) * 10000) /
          100
        : 0;

    const docData = {
      clientId,
      franchiseeId,
      documentType: "client_report" as const,
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
        data: {
          franchiseeName: section.name,
          totalAmount: section.totalAmount,
          commissionAmount: section.commissionAmount,
          commissionRate,
          netAmount: section.totalAmount - section.commissionAmount,
          periodMonth,
          periodYear,

        },
        errors: [],
        warnings: [],
      } as unknown as Record<string, unknown>,
      totalAmount: section.totalAmount.toString(),
      commissionAmount: section.commissionAmount.toString(),
      commissionRate: commissionRate.toString(),
      netAmount: (section.totalAmount - section.commissionAmount).toString(),
      reviewNotes:
        `חלק מדוח ${parserCode} מאוחד לישות (${fileName}) המכיל ${sections.length} מסעדות: ` +
        `${sections.map((s) => s.name).join(", ")}. ` +
        `הסכום כאן הוא החלק של "${section.name}" בלבד.`,
      // gmail_message_id is UNIQUE, and one email produces several documents
      // here — only the first may carry it.
      gmailMessageId:
        gmailMessageId && result.documentsWritten === 0 ? gmailMessageId : null,
      updatedAt: new Date(),
    };

    if (existing) {
      await database
        .update(clientDocument)
        .set(docData)
        .where(eq(clientDocument.id, existing.id));
    } else {
      await database.insert(clientDocument).values(docData);
    }

    result.documentsWritten++;
    result.matched.push({
      franchiseeName: match.matchedFranchisee.name,
      totalAmount: section.totalAmount,
    });
  }

  if (result.unmatched.length > 0) {
    result.errors.push(
      `דוח ${parserCode} מאוחד (${fileName}): לא זוהה זכיין עבור ${result.unmatched.length} מסעדות — ` +
        `${result.unmatched.join(", ")}. הסכומים שלהן לא נשמרו.`,
    );
  }

  return result;
}


/**
 * Fold a second source file into an existing document as a PART, when it
 * covers a different slice of the same month.
 *
 * Wolt split קינג קונג מוצקין's July 2026 into two payouts (01-16/07 and
 * 16/07-01/08). The second file hit the overwrite guard, was parked in the
 * review queue nobody works, and the stored figure stayed ₪97,869 against a
 * real ₪212,273 — a 54% under-report that no check but the Tabit cross-check
 * could see.
 *
 * Merging keeps the parent row exactly as every consumer expects — one row per
 * (client, franchisee, period) — and makes its totals the SUM of the parts.
 * Nothing downstream has to learn anything.
 *
 * Returns null, leaving the caller to refuse as before, whenever the merge is
 * not provably safe:
 *   • either file name carries no coverage window (unknown ≠ full month)
 *   • the windows overlap — that is the same money twice, and a real conflict
 *   • the incoming file has no parsed total to add
 *
 * The first merge backfills a part for the file already stored, so the parts
 * always account for the whole parent, never just the newcomers.
 */
async function tryMergeAsPart(args: {
  existing: {
    id: string;
    originalFileName: string;
    fileUrl: string | null;
    totalAmount: string | null;
    commissionAmount: string | null;
    gmailMessageId: string | null;
  };
  fileName: string;
  fileUrl: string;
  totalAmount: number | null;
  commissionAmount: number | null;
  gmailMessageId: string | null;
}): Promise<ClientDocument | null> {
  const { existing } = args;

  const incoming = extractCoveragePeriod(args.fileName);
  if (!incoming || args.totalAmount === null) return null;

  const existingCoverage = extractCoveragePeriod(existing.originalFileName);
  if (!existingCoverage) return null;

  const parts = await database
    .select()
    .from(clientDocumentPart)
    .where(eq(clientDocumentPart.clientDocumentId, existing.id));

  // First split for this document — record what is already stored, so the
  // parts sum to the parent rather than to the newcomer alone.
  if (parts.length === 0) {
    if (periodsOverlap(existingCoverage, incoming)) return null;
    await database.insert(clientDocumentPart).values({
      clientDocumentId: existing.id,
      originalFileName: existing.originalFileName,
      fileUrl: existing.fileUrl,
      coverageStart: existingCoverage.start,
      coverageEnd: existingCoverage.end,
      totalAmount: existing.totalAmount,
      commissionAmount: existing.commissionAmount,
      gmailMessageId: existing.gmailMessageId,
    });
  } else {
    for (const part of parts) {
      const window: CoveragePeriod = {
        start: part.coverageStart,
        end: part.coverageEnd,
      };
      if (periodsOverlap(window, incoming)) return null;
    }
  }

  await database.insert(clientDocumentPart).values({
    clientDocumentId: existing.id,
    originalFileName: args.fileName,
    fileUrl: args.fileUrl,
    coverageStart: incoming.start,
    coverageEnd: incoming.end,
    totalAmount: args.totalAmount.toString(),
    commissionAmount: args.commissionAmount?.toString() ?? null,
    gmailMessageId: args.gmailMessageId,
  });

  const allParts = await database
    .select()
    .from(clientDocumentPart)
    .where(eq(clientDocumentPart.clientDocumentId, existing.id));

  const sum = (pick: (p: (typeof allParts)[number]) => string | null): number =>
    allParts.reduce((acc, p) => acc + parseFloat(pick(p) ?? "0"), 0);

  const total = Math.round(sum((p) => p.totalAmount) * 100) / 100;
  const commission = Math.round(sum((p) => p.commissionAmount) * 100) / 100;

  const [updated] = await database
    .update(clientDocument)
    .set({
      totalAmount: total.toString(),
      commissionAmount: commission.toString(),
      netAmount: (Math.round((total - commission) * 100) / 100).toString(),
      reviewNotes:
        `חודש מפוצל: ${allParts.length} קבצים מרכיבים את הסכום — ` +
        allParts
          .map(
            (p) =>
              `${p.originalFileName} (${p.coverageStart}→${p.coverageEnd}) ₪${parseFloat(p.totalAmount ?? "0").toLocaleString("he-IL")}`,
          )
          .join(" + "),
      updatedAt: new Date(),
    })
    .where(eq(clientDocument.id, existing.id))
    .returning();

  return updated;
}
