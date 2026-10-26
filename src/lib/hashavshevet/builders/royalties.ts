import {
  createHashavshevetExportOperations,
  readBrandCompanyId,
} from "@/data-access/franchisee-billing-export";
import type { FranchiseeBillingStatus } from "@/db/schema";
import {
  type FranchiseeBillingItemType,
  type FranchiseeBillingPeriod,
} from "@/schemas/franchisee-billing-screen";
import { royaltiesParams } from "@/schemas/hashavshevet";
import { exportLabels } from "../copy";
import { apiDocumentId, apiMoney, apiQuantity } from "../format";
import type { ExportDefinition } from "../registry";
import type { ApiRow, BuiltRow } from "../types";

/**
 * Royalties and marketing export: the row logic shared by the Excel route
 * (franchisee-billing/hashavshevet-export) and the Hashavshevet API send path.
 * Moved out of the route verbatim; the Excel output must not change by a single number.
 */

export const ITEM_KEYS = {
  royalty: "הכנסותת",
  marketing: "שיווק",
} as const;
export const ITEM_LABELS = {
  royalty: "תמלוגים",
  marketing: "שיווק",
} as const;
export const ITEM_TYPES: readonly FranchiseeBillingItemType[] = [
  "royalty",
  "marketing",
];

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
  readonly franchiseeId: string;
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
      franchiseeId: row.franchiseeId,
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

export const BRAND_NOT_FOUND_MESSAGE = "המותג שנבחר לא נמצא";

/** The nine Excel columns, in order. `displayRow` keys match these. */
export const HASHAVSHEVET_HEADERS = [
  "מפתח חשבון",
  "שם",
  "מפתח פריט",
  "שם פריט",
  "כמות",
  "מחיר",
  "סוג המסמך",
  "מספר מסמך",
  "פרטים",
] as const;

/** One spreadsheet row as `{column: value}`, in column order. The workbook and the preview both read this. */
export function displayRow(row: HashavshevetRow): Record<string, string | number> {
  return {
    "מפתח חשבון": row.accountKey,
    "שם": row.accountName,
    "מפתח פריט": row.itemKey,
    "שם פריט": row.itemName,
    "כמות": row.quantity,
    "מחיר": row.price,
    "סוג המסמך": row.documentType,
    "מספר מסמך": row.documentNumber,
    "פרטים": row.details,
  };
}

export function incompleteMessage(completeness: BrandCompleteness): string {
  const names = completeness.missing
    .map((item) => item.franchiseeName)
    .join(", ");
  const detail = completeness.totalActive === 0
    ? "אין זכיינים פעילים במותג"
    : `חסרים: ${names}`;
  return `לא ניתן לייצא ${completeness.brandName}: ${completeness.readyCount}/${completeness.totalActive}. ${detail}`;
}

export interface RoyaltiesData {
  /** null = the brand does not exist (or is inactive / unsupported). */
  readonly context: BrandExportContext | null;
  /** The brand's Hashavshevet company; null = unmapped. */
  readonly companyId: string | null;
  readonly itemType: FranchiseeBillingItemType;
  readonly year: number;
  readonly month: number;
}

/**
 * Read-only DB read of the brand context, through the same loader the Excel
 * route's status mode uses. No locks and no writes: the API path never records an Excel export.
 */
export async function loadRoyaltiesData(params: unknown): Promise<RoyaltiesData> {
  const { year, month, brandId, itemType } = royaltiesParams.parse(params);
  const operations = await createHashavshevetExportOperations();
  const [contexts, companyId] = await Promise.all([
    operations.readBrandContexts({ year, month }),
    readBrandCompanyId(brandId),
  ]);
  const context = contexts.find((item) => item.brandId === brandId) ?? null;
  return { context, companyId, itemType, year, month };
}

/** YYYY-MM-DD of the month's last day, from local date parts (never toISOString). */
function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function apiRowOf(row: HashavshevetRow): ApiRow {
  const documentId = apiDocumentId(Number(row.documentType));
  if (documentId === null) {
    throw new Error(`No API DocumentID for Excel document type ${row.documentType}`);
  }
  const apiRow: ApiRow = {
    accountKey: row.accountKey,
    itemkey: row.itemKey,
    Quantity: apiQuantity(row.quantity),
    price: apiMoney(row.price),
    DocumentID: documentId,
    Reference: row.documentNumber,
  };
  if (row.details) apiRow.details = row.details;
  return apiRow;
}

function toBuiltRow(row: HashavshevetRow, data: RoyaltiesData): BuiltRow {
  const month = String(data.month).padStart(2, "0");
  const rowKey = `${row.franchiseeId}|${data.year}-${month}|${data.itemType}`;
  return {
    rowKey,
    companyId: data.companyId,
    documentKey: rowKey,
    amount: row.price,
    display: displayRow(row),
    apiRow: apiRowOf(row),
    periodEnd: lastDayOfMonth(data.year, data.month),
  };
}

/** The Excel route throws these; the API path reports them as blocking errors. */
export function buildRoyaltiesRows(
  data: RoyaltiesData,
): { rows: BuiltRow[]; blockingErrors: string[] } {
  const blocked = (message: string) => ({ rows: [], blockingErrors: [message] });
  if (!data.context) return blocked(BRAND_NOT_FOUND_MESSAGE);
  const completeness = summarizeBrandCompleteness(data.context);
  if (!completeness.canExport) return blocked(incompleteMessage(completeness));
  try {
    const rows = buildHashavshevetExportRows(data.context, data.itemType);
    return { rows: rows.map((row) => toBuiltRow(row, data)), blockingErrors: [] };
  } catch (error: unknown) {
    if (error instanceof HashavshevetExportError) return blocked(error.message);
    throw error;
  }
}

export const royaltiesExport: ExportDefinition = {
  type: "royalties",
  plugin: "imovein",
  labelHe: exportLabels.royalties,
  build: async (params) => buildRoyaltiesRows(await loadRoyaltiesData(params)),
};
