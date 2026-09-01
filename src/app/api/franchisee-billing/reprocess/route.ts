import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { database } from "@/db";
import * as schema from "@/db/schema";
import {
  isAuthError,
  requireAdminOrSuperUser,
} from "@/lib/api-middleware";
import {
  checkRateLimit,
  createRateLimitHeaders,
  getClientIP,
  RateLimitConfigs,
} from "@/lib/rate-limit";
import { processRoyaltyRevenueUpload } from "@/lib/royalty-revenue-processor";
import type { BillingRowOverride } from "@/data-access/franchisee-billing";
import { getDocument } from "@/lib/storage";
import { franchiseeBillingReprocessSchema } from "@/schemas/franchisee-billing-upload";

export const runtime = "nodejs";

interface StoredSource {
  readonly fileUrl: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly rowOverrides: readonly BillingRowOverride[];
}

/** The decisions already stored on a file, ignoring anything malformed. */
function readStoredOverrides(metadata: unknown): readonly BillingRowOverride[] {
  const stored =
    typeof metadata === "object" && metadata !== null && "rowOverrides" in metadata
      ? (metadata as { rowOverrides?: unknown }).rowOverrides
      : null;
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((entry: unknown) =>
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as { rowIndex?: unknown }).rowIndex === "number" &&
    (typeof (entry as { franchiseeId?: unknown }).franchiseeId === "string" ||
      (entry as { franchiseeId?: unknown }).franchiseeId === null)
      ? [entry as BillingRowOverride]
      : [],
  );
}

/** The newest decision about a row replaces any earlier one. */
function mergeOverrides(
  stored: readonly BillingRowOverride[],
  override: BillingRowOverride | undefined,
): readonly BillingRowOverride[] {
  if (!override) return stored;
  return [
    ...stored.filter((entry) => entry.rowIndex !== override.rowIndex),
    override,
  ];
}

/**
 * The stored royalty workbook behind a source file id, or null when the id is
 * not a royalty upload — never trust the id from the request body on its own.
 */
async function readStoredSource(
  sourceFileId: string,
): Promise<StoredSource | null> {
  const [row] = await database
    .select({
      fileUrl: schema.uploadedFile.fileUrl,
      fileName: schema.uploadedFile.originalFileName,
      mimeType: schema.uploadedFile.mimeType,
      documentType: schema.uploadedFile.metadata,
    })
    .from(schema.uploadedFile)
    .where(eq(schema.uploadedFile.id, sourceFileId))
    .limit(1);
  if (!row) return null;
  const metadata = row.documentType;
  const documentType =
    typeof metadata === "object" && metadata !== null && "documentType" in metadata
      ? (metadata as { documentType?: unknown }).documentType
      : null;
  if (documentType !== "franchisee_royalty_revenue") return null;
  return {
    fileUrl: row.fileUrl,
    fileName: row.fileName,
    mimeType: row.mimeType,
    rowOverrides: readStoredOverrides(metadata),
  };
}

/**
 * POST /api/franchisee-billing/reprocess - Re-runs a stored monthly Tabit
 * workbook through the upload pipeline.
 *
 * Anomalies are frozen into a file when it is uploaded, so a scale approved or
 * an alias fixed afterwards leaves the month blocked by findings that are no
 * longer true — and the rows those findings blocked were never drafted. This
 * replays the file already on disk instead of asking for it from Tabit again.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const limit = checkRateLimit(
    `franchisee-royalty-reprocess:${getClientIP(request)}`,
    RateLimitConfigs.upload,
  );
  if (!limit.success) {
    return NextResponse.json(
      { success: false, error: "בוצעו יותר מדי בקשות. נסי שוב בעוד דקה" },
      { status: 429, headers: createRateLimitHeaders(limit) },
    );
  }

  try {
    const validation = franchiseeBillingReprocessSchema.safeParse(
      await request.json(),
    );
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "מזהה קובץ לא תקין" },
        { status: 400 },
      );
    }

    const source = await readStoredSource(validation.data.sourceFileId);
    if (!source) {
      return NextResponse.json(
        { success: false, error: "קובץ המקור לא נמצא" },
        { status: 404 },
      );
    }

    const buffer = await getDocument(source.fileUrl);
    if (!buffer) {
      return NextResponse.json(
        {
          success: false,
          error: "לא ניתן לקרוא את הקובץ השמור. יש להעלות אותו מחדש",
        },
        { status: 502 },
      );
    }

    const rowOverrides = mergeOverrides(
      source.rowOverrides,
      validation.data.override,
    );
    const result = await processRoyaltyRevenueUpload({
      buffer,
      fileName: source.fileName,
      mimeType: source.mimeType,
      uploadedByEmail: authResult.user.email,
      // Replaying in place: a second row for the same workbook would keep
      // reporting the findings this run just cleared.
      sourceFileId: validation.data.sourceFileId,
      ...(rowOverrides.length ? { rowOverrides } : {}),
    });
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.errors.join("; ") || "עיבוד הקובץ נכשל",
          data: result,
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error: unknown) {
    console.error("[franchisee-royalty-reprocess] Request failed", { error });
    return NextResponse.json(
      { success: false, error: "שגיאה זמנית בעיבוד הקובץ" },
      { status: 500 },
    );
  }
}
