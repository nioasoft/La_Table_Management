import { NextRequest, NextResponse } from "next/server";
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
import { franchiseeBillingUploadSchema } from "@/schemas/franchisee-billing-upload";

export const runtime = "nodejs";

function logCompletion(
  requestId: string,
  startedAt: number,
  status: number,
  details: Record<string, unknown> = {},
): void {
  console.info(
    JSON.stringify({
      event: "franchisee_royalty_upload",
      requestId,
      status,
      latencyMs: Date.now() - startedAt,
      ...details,
    }),
  );
}

function rateLimitResponse(request: NextRequest): NextResponse | null {
  const limit = checkRateLimit(
    `franchisee-royalty:${getClientIP(request)}`,
    RateLimitConfigs.upload,
  );
  if (limit.success) return null;
  return NextResponse.json(
    {
      success: false,
      error: "בוצעו יותר מדי העלאות. נסי שוב בעוד דקה",
    },
    { status: 429, headers: createRateLimitHeaders(limit) },
  );
}

interface RequestContext {
  readonly requestId: string;
  readonly startedAt: number;
}

async function validateUploadedFile(
  request: NextRequest,
  context: RequestContext,
): Promise<File | NextResponse> {
  const formData = await request.formData();
  const validation = franchiseeBillingUploadSchema.safeParse({
    file: formData.get("file"),
  });
  if (validation.success) return validation.data.file;
  const error = validation.error.issues[0]?.message ?? "קובץ לא תקין";
  logCompletion(context.requestId, context.startedAt, 400, {
    error: "validation",
  });
  return NextResponse.json(
    { success: false, error, requestId: context.requestId },
    { status: 400 },
  );
}

async function processUploadedFile(
  file: File,
  uploadedByEmail: string,
  context: RequestContext,
): Promise<NextResponse> {
  const result = await processRoyaltyRevenueUpload({
    buffer: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    uploadedByEmail,
  });
  if (!result.success) {
    const error = result.errors.join("; ") || "עיבוד הקובץ נכשל";
    logCompletion(context.requestId, context.startedAt, 422, {
      error: "processing",
    });
    return NextResponse.json(
      { success: false, error, data: result, requestId: context.requestId },
      { status: 422 },
    );
  }
  logCompletion(context.requestId, context.startedAt, 201, {
    draftsWritten: result.draftsWritten,
    anomalies: result.anomalies.length,
    approvedDifferences: result.approvedDifferences.length,
  });
  return NextResponse.json(
    { success: true, data: result, requestId: context.requestId },
    { status: 201 },
  );
}

function unexpectedErrorResponse(
  error: unknown,
  context: RequestContext,
): NextResponse {
  console.error("[franchisee-royalty-upload] Request failed", {
    requestId: context.requestId,
    error,
  });
  logCompletion(context.requestId, context.startedAt, 500, {
    error: "unexpected",
  });
  return NextResponse.json(
    {
      success: false,
      error: `שגיאה זמנית בעיבוד הקובץ. קוד פנייה: ${context.requestId}`,
      requestId: context.requestId,
    },
    { status: 500 },
  );
}

/**
 * Accepts one monthly Tabit royalty-revenue workbook.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const context = {
    startedAt: Date.now(),
    requestId: request.headers.get("x-vercel-id") ?? crypto.randomUUID(),
  };
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const limited = rateLimitResponse(request);
  if (limited) return limited;

  try {
    const file = await validateUploadedFile(request, context);
    if (file instanceof NextResponse) return file;
    return processUploadedFile(file, authResult.user.email, context);
  } catch (error: unknown) {
    return unexpectedErrorResponse(error, context);
  }
}
