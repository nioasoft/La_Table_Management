import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { createHashavshevetExportOperations } from "@/data-access/franchisee-billing-export";
import type { FranchiseeBillingStatus } from "@/db/schema";
import {
  isAuthError,
  requireAdminOrSuperUser,
} from "@/lib/api-middleware";
import {
  franchiseeBillingHashavshevetQuerySchema,
  type FranchiseeBillingItemType,
  type FranchiseeBillingPeriod,
} from "@/schemas/franchisee-billing-screen";

export const runtime = "nodejs";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ITEM_KEYS = {
  royalty: "הכנסותת",
  marketing: "שיווק",
} as const;
const ITEM_LABELS = {
  royalty: "תמלוגים",
  marketing: "שיווק",
} as const;
const EXPORT_BRAND_NAMES: Readonly<Record<string, string>> = {
  MINNA_TOMEI: "מינה טומאיי",
  VINNI: "פט ויני",
  KING_KONG: "קינג קונג",
};
const ACCOUNT_ORDER = [
  "אושיבה",
  "מינה עין שמר",
  "מינה",
  "אודון",
  "מינה שרונה",
  "ויני חדרה",
  "טמפר",
  "ויני כרמיאל",
  "סידיוס",
  "פט ויני ע",
  "מיאמוטו",
  "ויני רגבה",
  "קינג ח",
  "קינג קונג חורב",
  "קינג כרמיאל",
  "קינג ג",
  "קינג עפולה",
  "קינג ב",
  "קינג מ",
  "ק.ק מסעדה",
] as const;
const ACCOUNT_ORDER_INDEX: ReadonlyMap<string, number> = new Map(
  ACCOUNT_ORDER.map((accountKey, index) => [accountKey, index]),
);

export interface ExportBillingRow {
  readonly billingId: string | null;
  readonly franchiseeId: string;
  readonly franchiseeName: string;
  readonly accountKeySnapshot: string | null;
  readonly status: FranchiseeBillingStatus | null;
  readonly noRevenueReason: string | null;
  readonly royalty: string | null;
  readonly marketing: string | null;
  readonly total: string | null;
}

export interface BrandExportContext {
  readonly brandId: string;
  readonly brandCode: string;
  readonly brandName: string;
  readonly rows: readonly ExportBillingRow[];
}

export interface MissingFranchisee {
  readonly franchiseeId: string;
  readonly franchiseeName: string;
}

export interface BrandCompleteness {
  readonly brandId: string;
  readonly brandCode: string;
  readonly brandName: string;
  readonly readyCount: number;
  readonly totalActive: number;
  readonly canExport: boolean;
  readonly missing: readonly MissingFranchisee[];
}

export interface HashavshevetRow {
  readonly billingId: string;
  readonly accountKey: string;
  readonly accountName: "";
  readonly itemKey: string;
  readonly itemName: "";
  readonly quantity: 1;
  readonly price: number;
  readonly documentType: "11";
  readonly documentNumber: string;
  readonly details: "";
}

export interface HashavshevetExportInput
  extends FranchiseeBillingPeriod {
  readonly brandId: string;
  readonly itemType: FranchiseeBillingItemType;
}

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

export class HashavshevetExportError extends Error {
  constructor(
    readonly code: "not_found" | "incomplete" | "invalid_data",
    message: string,
  ) {
    super(message);
  }
}

function hasNoRevenueReason(row: ExportBillingRow): boolean {
  return Boolean(row.noRevenueReason?.trim());
}

function storedAmountIsZero(value: string | null): boolean {
  if (value === null || value.trim() === "") return false;
  const amount = Number(value);
  return Number.isFinite(amount) && amount === 0;
}

function rowIsReady(row: ExportBillingRow): boolean {
  if (row.status === "approved") return true;
  return (
    hasNoRevenueReason(row) &&
    storedAmountIsZero(row.royalty) &&
    storedAmountIsZero(row.marketing) &&
    storedAmountIsZero(row.total)
  );
}

export function summarizeBrandCompleteness(
  context: BrandExportContext,
): BrandCompleteness {
  const missing = context.rows
    .filter((row) => !rowIsReady(row))
    .map((row) => ({
      franchiseeId: row.franchiseeId,
      franchiseeName: row.franchiseeName,
    }));
  const totalActive = context.rows.length;
  return {
    brandId: context.brandId,
    brandCode: context.brandCode,
    brandName: context.brandName,
    readyCount: totalActive - missing.length,
    totalActive,
    canExport: totalActive > 0 && missing.length === 0,
    missing,
  };
}

function rowSortValue(row: ExportBillingRow): number {
  const key = row.accountKeySnapshot?.trim() ?? "";
  return ACCOUNT_ORDER_INDEX.get(key) ?? Number.MAX_SAFE_INTEGER;
}

function sortExportRows(
  rows: readonly ExportBillingRow[],
): ExportBillingRow[] {
  return rows
    .map((row, sourceIndex) => ({ row, sourceIndex }))
    .sort((left, right) => {
      const order = rowSortValue(left.row) - rowSortValue(right.row);
      if (order !== 0) return order;
      const nameOrder = left.row.franchiseeName.localeCompare(
        right.row.franchiseeName,
        "he",
      );
      return nameOrder || left.sourceIndex - right.sourceIndex;
    })
    .map(({ row }) => row);
}

function exportAmount(
  row: ExportBillingRow,
  itemType: FranchiseeBillingItemType,
): number {
  const stored = row[itemType];
  const amount = stored === null ? Number.NaN : Number(stored);
  if (!Number.isFinite(amount)) {
    throw new HashavshevetExportError(
      "invalid_data",
      `סכום ${ITEM_LABELS[itemType]} של ${row.franchiseeName} אינו תקין`,
    );
  }
  return amount;
}

export function buildHashavshevetExportRows(
  context: BrandExportContext,
  itemType: FranchiseeBillingItemType,
): HashavshevetRow[] {
  const approved = sortExportRows(
    context.rows.filter((row) => row.status === "approved"),
  );
  const rows = approved.flatMap((row) => {
    const price = exportAmount(row, itemType);
    if (price === 0) return [];
    const accountKey = row.accountKeySnapshot?.trim();
    if (!row.billingId || !accountKey) {
      throw new HashavshevetExportError(
        "invalid_data",
        `מפתח החשבון של ${row.franchiseeName} חסר בצילום האישור`,
      );
    }
    return [{
      billingId: row.billingId,
      accountKey,
      accountName: "" as const,
      itemKey: ITEM_KEYS[itemType],
      itemName: "" as const,
      quantity: 1 as const,
      price,
      documentType: "11" as const,
      documentNumber: "",
      details: "" as const,
    }];
  });
  return rows.map((row, index) => ({
    ...row,
    documentNumber: String(5000 + index),
  }));
}

export function buildHashavshevetWorkbookBuffer(
  rows: readonly HashavshevetRow[],
): Buffer {
  const headers = [
    "מפתח חשבון",
    "שם",
    "מפתח פריט",
    "שם פריט",
    "כמות",
    "מחיר",
    "סוג המסמך",
    "מספר מסמך",
    "פרטים",
  ];
  const data = [
    headers,
    ...rows.map((row) => [
      row.accountKey,
      row.accountName,
      row.itemKey,
      row.itemName,
      row.quantity,
      row.price,
      row.documentType,
      row.documentNumber,
      row.details,
    ]),
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
  const names = completeness.missing
    .map((item) => item.franchiseeName)
    .join(", ");
  const detail = completeness.totalActive === 0
    ? "אין זכיינים פעילים במותג"
    : `חסרים: ${names}`;
  throw new HashavshevetExportError(
    "incomplete",
    `לא ניתן לייצא ${completeness.brandName}: ${completeness.readyCount}/${completeness.totalActive}. ${detail}`,
  );
}

interface UploadTracker {
  url: string | null;
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
      "המותג שנבחר לא נמצא",
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

async function cleanupUploadedFile(
  operations: HashavshevetExportOperations,
  uploadedUrl: string | null,
): Promise<void> {
  if (!uploadedUrl) return;
  try {
    await operations.deleteFile(uploadedUrl);
  } catch (cleanupError: unknown) {
    console.error("[franchisee-billing-export] Blob cleanup failed", {
      uploadedUrl,
      cleanupError,
    });
  }
}

export async function executeHashavshevetExport(
  input: HashavshevetExportInput,
  exportedBy: string,
  operations: HashavshevetExportOperations,
): Promise<ExportArtifact> {
  const upload: UploadTracker = { url: null };
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
    await cleanupUploadedFile(operations, upload.url);
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
  return params.get("mode") === "status"
    ? { ...period, mode: "status" }
    : {
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
    if (validation.data.mode === "status") {
      return statusResponse(validation.data, activeOperations, context);
    }
    const exportInput: HashavshevetExportInput = {
      year: validation.data.year,
      month: validation.data.month,
      brandId: validation.data.brandId,
      itemType: validation.data.itemType,
    };
    return fileResponse(
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
