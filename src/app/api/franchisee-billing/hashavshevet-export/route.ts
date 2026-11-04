import AdmZip from "adm-zip";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { createHashavshevetExportOperations } from "@/data-access/franchisee-billing-export";
import {
  isAuthError,
  requireAdminOrSuperUser,
} from "@/lib/api-middleware";
import {
  BRAND_NOT_FOUND_MESSAGE,
  HASHAVSHEVET_HEADERS,
  HashavshevetExportError,
  ITEM_LABELS,
  ITEM_TYPES,
  buildHashavshevetExportRows,
  displayRow,
  incompleteMessage,
  summarizeBrandCompleteness,
  type BrandCompleteness,
  type BrandExportContext,
  type HashavshevetExportInput,
  type HashavshevetRow,
} from "@/lib/hashavshevet/builders/royalties";
import {
  franchiseeBillingHashavshevetQuerySchema,
  type FranchiseeBillingItemType,
  type FranchiseeBillingPeriod,
} from "@/schemas/franchisee-billing-screen";

// The row logic lives in the shared builder; these keep the route's public surface unchanged.
export { HashavshevetExportError, buildHashavshevetExportRows, summarizeBrandCompleteness };
export type {
  BrandCompleteness,
  BrandExportContext,
  ExportBillingRow,
  HashavshevetExportInput,
  HashavshevetRow,
  MissingFranchisee,
} from "@/lib/hashavshevet/builders/royalties";

export const runtime = "nodejs";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_FILE_NAME = "תמלוגים ושיווק זכיינים.zip";
const EXPORT_BRAND_NAMES: Readonly<Record<string, string>> = {
  MINNA_TOMEI: "מינה טומאיי",
  VINNI: "פט ויני",
  KING_KONG: "קינג קונג",
};
export interface PersistExportInput extends HashavshevetExportInput {
  readonly batchId: string;
  readonly exportedAt: Date;
  readonly exportedBy: string;
  readonly rowCount: number;
  readonly blobUrl: string;
  readonly billingIds: readonly string[];
}

export interface StoredExportFile {
  readonly url: string;
  readonly pathname: string;
}

export interface HashavshevetExportStore {
  readonly loadBrandContextForUpdate: (
    input: HashavshevetExportInput,
  ) => Promise<BrandExportContext | null>;
  readonly persistExport: (input: PersistExportInput) => Promise<void>;
}

export interface HashavshevetExportOperations {
  readonly readBrandContexts: (
    period: FranchiseeBillingPeriod,
  ) => Promise<readonly BrandExportContext[]>;
  readonly withTransaction: <T>(
    work: (store: HashavshevetExportStore) => Promise<T>,
  ) => Promise<T>;
  readonly storeFile: (input: {
    readonly pathname: string;
    readonly buffer: Buffer;
  }) => Promise<StoredExportFile>;
  readonly deleteFile: (url: string) => Promise<void>;
}

interface ExportArtifact {
  readonly batchId: string;
  readonly buffer: Buffer;
  readonly fileName: string;
  readonly rowCount: number;
}

interface RequestContext {
  readonly requestId: string;
  readonly startedAt: number;
}

export function buildHashavshevetWorkbookBuffer(
  rows: readonly HashavshevetRow[],
): Buffer {
  const data = [
    [...HASHAVSHEVET_HEADERS],
    ...rows.map((row) => Object.values(displayRow(row))),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  worksheet["!cols"] = [
    { wch: 18 },
    { wch: 10 },
    { wch: 14 },
    { wch: 10 },
    { wch: 8 },
    { wch: 20 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "ייבוא חשבשבת");
  workbook.Workbook = {
    ...(workbook.Workbook ?? {}),
    Names: [{
      Name: "חוזים",
      Ref: `'ייבוא חשבשבת'!$A$1:$I$${rows.length + 1}`,
    }],
  };
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

function exportFileName(
  context: BrandExportContext,
  itemType: FranchiseeBillingItemType,
): string {
  const brandName =
    EXPORT_BRAND_NAMES[context.brandCode] ?? context.brandName;
  return `${brandName} ${ITEM_LABELS[itemType]} זכיינים.xlsx`;
}

function exportPathname(
  input: HashavshevetExportInput,
  batchId: string,
): string {
  const month = String(input.month).padStart(2, "0");
  return [
    "franchisee-billing",
    "hashavshevet",
    String(input.year),
    month,
    input.brandId,
    input.itemType,
    `${batchId}.xlsx`,
  ].join("/");
}

function incompleteError(completeness: BrandCompleteness): never {
  throw new HashavshevetExportError(
    "incomplete",
    incompleteMessage(completeness),
  );
}

interface UploadTracker {
  url: string | null;
  /** Every file the run put in blob storage, so a failure can undo them all. */
  readonly urls: string[];
}

async function exportWithinTransaction(
  input: HashavshevetExportInput,
  exportedBy: string,
  operations: HashavshevetExportOperations,
  store: HashavshevetExportStore,
  upload: UploadTracker,
): Promise<ExportArtifact> {
  const context = await store.loadBrandContextForUpdate(input);
  if (!context) {
    throw new HashavshevetExportError(
      "not_found",
      BRAND_NOT_FOUND_MESSAGE,
    );
  }
  const completeness = summarizeBrandCompleteness(context);
  if (!completeness.canExport) incompleteError(completeness);
  const rows = buildHashavshevetExportRows(context, input.itemType);
  const buffer = buildHashavshevetWorkbookBuffer(rows);
  const batchId = crypto.randomUUID();
  const stored = await operations.storeFile({
    pathname: exportPathname(input, batchId),
    buffer,
  });
  upload.url = stored.url;
  upload.urls.push(stored.url);
  await store.persistExport({
    ...input,
    batchId,
    exportedAt: new Date(),
    exportedBy,
    rowCount: rows.length,
    blobUrl: stored.url,
    billingIds: rows.map((row) => row.billingId),
  });
  return {
    batchId,
    buffer,
    fileName: exportFileName(context, input.itemType),
    rowCount: rows.length,
  };
}

async function cleanupUploadedFiles(
  operations: HashavshevetExportOperations,
  uploadedUrls: readonly string[],
): Promise<void> {
  for (const uploadedUrl of uploadedUrls) {
    try {
      await operations.deleteFile(uploadedUrl);
    } catch (cleanupError: unknown) {
      console.error("[franchisee-billing-export] Blob cleanup failed", {
        uploadedUrl,
        cleanupError,
      });
    }
  }
}

export async function executeHashavshevetExport(
  input: HashavshevetExportInput,
  exportedBy: string,
  operations: HashavshevetExportOperations,
): Promise<ExportArtifact> {
  const upload: UploadTracker = { url: null, urls: [] };
  try {
    return await operations.withTransaction((store) =>
      exportWithinTransaction(
        input,
        exportedBy,
        operations,
        store,
        upload,
      ));
  } catch (error: unknown) {
    await cleanupUploadedFiles(operations, upload.urls);
    throw error;
  }
}

/**
 * Every brand's royalty and marketing file, in one archive and one
 * transaction. All or nothing on purpose: a bundle that quietly leaves a brand
 * out is a month billed short that nobody is told about.
 */
export async function executeHashavshevetZipExport(
  period: FranchiseeBillingPeriod,
  exportedBy: string,
  operations: HashavshevetExportOperations,
): Promise<readonly ExportArtifact[]> {
  const brands = await operations.readBrandContexts(period);
  if (brands.length === 0) {
    throw new HashavshevetExportError(
      "not_found",
      "אין מותגים זמינים לייצוא",
    );
  }
  // Checked before a single file is built, so a brand that is not ready costs
  // nothing but the message.
  const blocked = brands
    .map(summarizeBrandCompleteness)
    .filter((completeness) => !completeness.canExport);
  if (blocked.length > 0) {
    throw new HashavshevetExportError(
      "incomplete",
      `לא ניתן לייצא הכל: ${blocked
        .map((brand) =>
          `${brand.brandName} ${brand.readyCount}/${brand.totalActive}`)
        .join(", ")}. יש לאשר או לסמן ללא מחזור את כל הזכיינים.`,
    );
  }
  const upload: UploadTracker = { url: null, urls: [] };
  try {
    return await operations.withTransaction(async (store) => {
      const artifacts: ExportArtifact[] = [];
      for (const brand of brands) {
        for (const itemType of ITEM_TYPES) {
          artifacts.push(
            await exportWithinTransaction(
              { ...period, brandId: brand.brandId, itemType },
              exportedBy,
              operations,
              store,
              upload,
            ),
          );
        }
      }
      return artifacts;
    });
  } catch (error: unknown) {
    await cleanupUploadedFiles(operations, upload.urls);
    throw error;
  }
}

function requestContext(request: NextRequest): RequestContext {
  return {
    requestId: request.headers.get("x-vercel-id") ?? crypto.randomUUID(),
    startedAt: Date.now(),
  };
}

function logCompletion(
  context: RequestContext,
  status: number,
  details: Record<string, unknown>,
): void {
  console.info(JSON.stringify({
    event: "franchisee_billing_hashavshevet_export",
    requestId: context.requestId,
    status,
    latencyMs: Date.now() - context.startedAt,
    ...details,
  }));
}

function queryInput(request: NextRequest): Record<string, string | undefined> {
  const params = request.nextUrl.searchParams;
  const period = {
    year: params.get("year") ?? undefined,
    month: params.get("month") ?? undefined,
  };
  const mode = params.get("mode");
  if (mode === "status" || mode === "zip") return { ...period, mode };
  return {
    ...period,
    mode: "file",
    brandId: params.get("brandId") ?? undefined,
    itemType: params.get("itemType") ?? undefined,
  };
}

function errorStatus(error: HashavshevetExportError): number {
  if (error.code === "not_found") return 404;
  return error.code === "incomplete" ? 409 : 422;
}

function errorResponse(
  error: unknown,
  context: RequestContext,
): NextResponse {
  if (error instanceof HashavshevetExportError) {
    const status = errorStatus(error);
    logCompletion(context, status, { error: error.code });
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        requestId: context.requestId,
      },
      { status },
    );
  }
  console.error("[franchisee-billing-export] Request failed", {
    requestId: context.requestId,
    error,
  });
  logCompletion(context, 500, { error: "unexpected" });
  return NextResponse.json(
    {
      success: false,
      error: `הייצוא נכשל. לא נשמר סימון גבייה. קוד פנייה: ${context.requestId}`,
      requestId: context.requestId,
    },
    { status: 500 },
  );
}

function validationErrorResponse(
  error: string,
  context: RequestContext,
): NextResponse {
  logCompletion(context, 400, { error: "validation" });
  return NextResponse.json(
    { success: false, error, requestId: context.requestId },
    { status: 400 },
  );
}

async function statusResponse(
  period: FranchiseeBillingPeriod,
  operations: HashavshevetExportOperations,
  context: RequestContext,
): Promise<NextResponse> {
  const brands = await operations.readBrandContexts(period);
  const summaries = brands.map(summarizeBrandCompleteness);
  logCompletion(context, 200, {
    mode: "status",
    brands: summaries.length,
  });
  return NextResponse.json({
    success: true,
    // `mode` is a request detail, not part of the period the client validates.
    data: { period: { year: period.year, month: period.month }, brands: summaries },
    requestId: context.requestId,
  });
}

async function fileResponse(
  input: HashavshevetExportInput,
  exportedBy: string,
  operations: HashavshevetExportOperations,
  context: RequestContext,
): Promise<NextResponse> {
  const artifact = await executeHashavshevetExport(
    input,
    exportedBy,
    operations,
  );
  logCompletion(context, 200, {
    mode: "file",
    batchId: artifact.batchId,
    rows: artifact.rowCount,
    itemType: input.itemType,
  });
  const encodedName = encodeURIComponent(artifact.fileName);
  return new NextResponse(new Uint8Array(artifact.buffer), {
    status: 200,
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
      "X-Export-Batch-Id": artifact.batchId,
    },
  });
}

async function zipResponse(
  period: FranchiseeBillingPeriod,
  exportedBy: string,
  operations: HashavshevetExportOperations,
  context: RequestContext,
): Promise<NextResponse> {
  const artifacts = await executeHashavshevetZipExport(
    period,
    exportedBy,
    operations,
  );
  const zip = new AdmZip();
  for (const artifact of artifacts) {
    zip.addFile(artifact.fileName, artifact.buffer);
  }
  logCompletion(context, 200, {
    mode: "zip",
    files: artifacts.length,
    rows: artifacts.reduce((sum, artifact) => sum + artifact.rowCount, 0),
  });
  const encodedName = encodeURIComponent(ZIP_FILE_NAME);
  return new NextResponse(new Uint8Array(zip.toBuffer()), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
    },
  });
}

export async function handleHashavshevetExport(
  request: NextRequest,
  operations?: HashavshevetExportOperations,
): Promise<NextResponse> {
  const context = requestContext(request);
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const validation = franchiseeBillingHashavshevetQuerySchema.safeParse(
    queryInput(request),
  );
  if (!validation.success) {
    const error =
      validation.error.issues[0]?.message ?? "פרטי הייצוא אינם תקינים";
    return validationErrorResponse(error, context);
  }
  const activeOperations =
    operations ?? await createHashavshevetExportOperations();
  try {
    // `return await`, not `return`: an async function adopts a returned
    // promise, so its rejection would skip the catch below and surface as an
    // unhandled 500 with no Hebrew message and no cleanup.
    if (validation.data.mode === "status") {
      return await statusResponse(validation.data, activeOperations, context);
    }
    if (validation.data.mode === "zip") {
      return await zipResponse(
        { year: validation.data.year, month: validation.data.month },
        authResult.user.id,
        activeOperations,
        context,
      );
    }
    const exportInput: HashavshevetExportInput = {
      year: validation.data.year,
      month: validation.data.month,
      brandId: validation.data.brandId,
      itemType: validation.data.itemType,
    };
    return await fileResponse(
      exportInput,
      authResult.user.id,
      activeOperations,
      context,
    );
  } catch (error: unknown) {
    return errorResponse(error, context);
  }
}

/**
 * Next passes a route context as the second argument. Aliasing the export
 * straight to the handler fed that context into the tests-only operations
 * parameter, and every real request crashed on a missing operations method.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleHashavshevetExport(request);
}
