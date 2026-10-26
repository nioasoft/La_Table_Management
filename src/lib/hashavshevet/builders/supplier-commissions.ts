import { database } from "@/db";
import {
  supplierFileUpload,
  supplier,
  franchisee,
  brand,
  reconciliationComparison,
  type SupplierFileProcessingResult,
} from "@/db/schema";
import { eq, and, gte, lte, inArray, or, sql, type SQL } from "drizzle-orm";
import { hasCommissionFromFile } from "@/lib/custom-parsers/suppliers-with-file-commission";
import { fileBelongsInExportRange } from "@/lib/settlement-periods";
import { supplierCommissionsParams } from "@/schemas/hashavshevet";
import { exportLabels } from "../copy";
import { apiDocumentId, apiMoney, apiQuantity } from "../format";
import type { ExportDefinition } from "../registry";
import type { ApiRow, BuiltRow } from "../types";

/**
 * Supplier commissions export ("עמלות ספקים לפי רשת"): the row logic shared by the
 * Excel route (reports/hashavshevet/export) and the Hashavshevet API send path.
 * Queries, gates, aggregation and numbering moved out of the route verbatim;
 * the Excel output must not change by a single number.
 */

/** The Excel route's query params, already parsed (arrays instead of comma lists). */
export interface SupplierCommissionsParams {
  startDate: string;
  endDate: string;
  brandIds: string[];
  supplierIds: string[];
  startDocNumber: number;
  onlyApproved: boolean;
}

export interface SupplierCommissionFile {
  fileId: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  hashavshevetCode: string | null;
  commissionRate: string | null;
  commissionType: string | null;
  settlementFrequency: string | null;
  processingResult: SupplierFileProcessingResult | null;
  /** YYYY-MM-DD as stored. */
  periodStartDate: string | null;
  periodEndDate: string | null;
}

export interface SupplierCommissionFranchisee {
  id: string;
  name: string;
  brandId: string;
  hashavshevetItemKey: string | null;
}

export interface SupplierCommissionBrand {
  id: string;
  nameHe: string;
  /** The brand's management company in Hashavshevet; null = unmapped. */
  hashavshevetCompanyId: string | null;
}

export interface SupplierCommissionsData extends SupplierCommissionsParams {
  files: SupplierCommissionFile[];
  franchisees: SupplierCommissionFranchisee[];
  brands: SupplierCommissionBrand[];
  /** `supplierId|franchiseeId|periodStart|periodEnd` approved in the latest fresh session. Empty when onlyApproved is off. */
  approvedKeys: Set<string>;
}

/** Approved / auto-approved files of the selected suppliers whose period overlaps the range. */
async function readFiles(
  params: SupplierCommissionsParams
): Promise<SupplierCommissionFile[]> {
  const { startDate, endDate, supplierIds } = params;
  const conditions: (SQL | undefined)[] = [
    or(
      eq(supplierFileUpload.processingStatus, "approved"),
      eq(supplierFileUpload.processingStatus, "auto_approved")
    ),
    // Period overlap (mirrors /api/reports/hashavshevet)
    lte(supplierFileUpload.periodStartDate, endDate),
    gte(supplierFileUpload.periodEndDate, startDate),
  ];

  // Add supplier filter if specified
  if (supplierIds.length > 0) {
    conditions.push(inArray(supplier.id, supplierIds));
  }

  return database
    .select({
      fileId: supplierFileUpload.id,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      hashavshevetCode: supplier.hashavshevetCode,
      commissionRate: supplier.defaultCommissionRate,
      commissionType: supplier.commissionType,
      settlementFrequency: supplier.settlementFrequency,
      processingResult: supplierFileUpload.processingResult,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
    })
    .from(supplierFileUpload)
    .innerJoin(supplier, eq(supplierFileUpload.supplierId, supplier.id))
    .where(and(...conditions));
}

/** Latest non-archived reconciliation session per (supplier, period) overlapping the range, by id. */
async function readFreshSessions(
  startDate: string,
  endDate: string
): Promise<Map<string, { supplierId: string; periodStart: string; periodEnd: string }>> {
  const freshSessions = await database.execute<{
    id: string;
    supplier_id: string;
    period_start_date: string;
    period_end_date: string;
  }>(sql`
    SELECT DISTINCT ON (supplier_id, period_start_date, period_end_date)
      id, supplier_id, period_start_date, period_end_date
    FROM reconciliation_session
    WHERE archived_at IS NULL
      AND period_start_date <= ${endDate}
      AND period_end_date >= ${startDate}
    ORDER BY supplier_id, period_start_date, period_end_date, created_at DESC
  `);

  const sessionContext = new Map<
    string,
    { supplierId: string; periodStart: string; periodEnd: string }
  >();
  for (const row of freshSessions.rows) {
    sessionContext.set(row.id, {
      supplierId: row.supplier_id,
      periodStart: row.period_start_date,
      periodEnd: row.period_end_date,
    });
  }
  return sessionContext;
}

/**
 * Same approval gate as /api/reports/hashavshevet — keeps preview and Excel in
 * sync: keys whose latest fresh session comparison was approved.
 */
async function readApprovedKeys(
  startDate: string,
  endDate: string
): Promise<Set<string>> {
  const approvedSet = new Set<string>();
  const sessionContext = await readFreshSessions(startDate, endDate);
  if (sessionContext.size === 0) return approvedSet;

  const approvedRows = await database
    .select({
      sessionId: reconciliationComparison.sessionId,
      franchiseeId: reconciliationComparison.franchiseeId,
    })
    .from(reconciliationComparison)
    .where(
      and(
        inArray(reconciliationComparison.sessionId, [...sessionContext.keys()]),
        inArray(reconciliationComparison.status, [
          "auto_approved",
          "manually_approved",
        ])
      )
    );

  for (const r of approvedRows) {
    const ctx = sessionContext.get(r.sessionId);
    if (!ctx) continue;
    approvedSet.add(
      `${ctx.supplierId}|${r.franchiseeId}|${ctx.periodStart}|${ctx.periodEnd}`
    );
  }
  return approvedSet;
}

/** All DB reads of the export. Read-only. */
export async function loadSupplierCommissionsData(
  params: SupplierCommissionsParams
): Promise<SupplierCommissionsData> {
  const files = await readFiles(params);

  const [franchisees, brands] = await Promise.all([
    database
      .select({
        id: franchisee.id,
        name: franchisee.name,
        brandId: franchisee.brandId,
        hashavshevetItemKey: franchisee.hashavshevetItemKey,
      })
      .from(franchisee),
    database
      .select({
        id: brand.id,
        nameHe: brand.nameHe,
        hashavshevetCompanyId: brand.hashavshevetCompanyId,
      })
      .from(brand),
  ]);

  // Empty when the flag is off.
  const approvedKeys = params.onlyApproved
    ? await readApprovedKeys(params.startDate, params.endDate)
    : new Set<string>();

  return { ...params, files, franchisees, brands, approvedKeys };
}

// ============================================================================
// ROWS (pure)
// ============================================================================

/** The eight Excel columns, in order. `display` keys match these. */
export const SUPPLIER_COMMISSIONS_HEADERS = [
  "מפתח חשבון",
  "שם",
  "מפתח פריט",
  "שם פריט",
  "כמות",
  "מחיר",
  "סוג המסמך",
  "מספר מסמך",
] as const;

/** Excel "סוג המסמך": invoice. */
const DOCUMENT_TYPE = 11;

export const MISSING_CODE_MESSAGE = "לא ניתן לייצא — יש ספקים ללא כרטיס חשבשבת";

export interface MissingSupplier {
  id: string;
  name: string;
  code: string | null;
}

/** One Excel file's rows. brandNameHe null = all selected brands in one file. */
export interface SupplierCommissionsSheet {
  brandNameHe: string | null;
  rows: BuiltRow[];
}

type FranchiseeMatch = SupplierFileProcessingResult["franchiseeMatches"][0];

interface AggregatedRow {
  rowKey: string;
  brandId: string;
  brandNameHe: string;
  companyId: string | null;
  accountKey: string;
  itemKey: string;
  price: number;
  periodEnd: string;
}

interface MatchLine {
  key: string;
  franchisee: SupplierCommissionFranchisee;
  brand: SupplierCommissionBrand;
  commission: number;
}

/**
 * Calculate commission for a franchisee match
 */
function calculateMatchCommission(
  match: FranchiseeMatch,
  supplierCommissionRate: string | null,
  supplierCommissionType: string | null,
  supplierCode?: string
): number {
  const isFileCommission = supplierCode ? hasCommissionFromFile(supplierCode) : false;
  // File-commission suppliers: always use file value (even 0 = no commission)
  // Other suppliers: only use positive pre-calculated values
  if (match.preCalculatedCommission != null && (isFileCommission || match.preCalculatedCommission > 0)) {
    return Math.round(match.preCalculatedCommission);
  }

  // Calculate based on supplier rate
  if (!supplierCommissionRate) return 0;

  const rate = parseFloat(supplierCommissionRate);
  if (isNaN(rate)) return 0;

  let commission = 0;
  if (supplierCommissionType === "percentage") {
    commission = match.netAmount * (rate / 100);
  } else if (supplierCommissionType === "per_item") {
    commission = rate;
  }

  return Math.round(commission);
}

/** One match's commission line, or null where the route skipped it. Checks run in the route's order. */
function matchLine(
  file: SupplierCommissionFile,
  match: FranchiseeMatch,
  data: SupplierCommissionsData,
  franchiseeMap: Map<string, SupplierCommissionFranchisee>,
  brandMap: Map<string, SupplierCommissionBrand>
): MatchLine | null {
  if (!match.matchedFranchiseeId || match.matchType === "blacklisted" || match.matchType === "none") {
    return null;
  }
  const franchiseeInfo = franchiseeMap.get(match.matchedFranchiseeId);
  if (!franchiseeInfo) return null;
  if (data.brandIds.length > 0 && !data.brandIds.includes(franchiseeInfo.brandId)) {
    return null;
  }
  const brandInfo = brandMap.get(franchiseeInfo.brandId);
  if (!brandInfo) return null;

  const commission = calculateMatchCommission(match, file.commissionRate, file.commissionType, file.supplierCode);
  if (commission === 0) return null;

  // Reconciliation gate and aggregation share this key (same shape as /api/reports/hashavshevet).
  const key = `${file.supplierId}|${match.matchedFranchiseeId}|${file.periodStartDate}|${file.periodEndDate}`;
  if (data.onlyApproved && !data.approvedKeys.has(key)) return null;
  return { key, franchisee: franchiseeInfo, brand: brandInfo, commission };
}

/**
 * Aggregation: per-invoice parsers (e.g. שרי שוקו) produce one franchisee match
 * per invoice. The Hashavshevet sheet holds one line per (supplier × franchisee ×
 * period) — same logic as /api/reports/hashavshevet. Suppliers with commissions
 * but no hashavshevetCode are collected instead of silently dropped.
 */
function aggregate(data: SupplierCommissionsData): { rows: AggregatedRow[]; missingSuppliers: MissingSupplier[] } {
  const franchiseeMap = new Map(data.franchisees.map((f) => [f.id, f]));
  const brandMap = new Map(data.brands.map((b) => [b.id, b]));
  const aggregated = new Map<string, AggregatedRow>();
  const missing = new Map<string, MissingSupplier>();

  for (const file of data.files) {
    if (!file.processingResult) continue;
    // Frequency gate: monthly suppliers appear in monthly runs; multi-month
    // runs take only their last-month file (earlier months already billed).
    if (!fileBelongsInExportRange(file.settlementFrequency, file.periodStartDate, data.startDate, data.endDate)) {
      continue;
    }
    if (!file.processingResult.franchiseeMatches) continue;

    for (const match of file.processingResult.franchiseeMatches) {
      const line = matchLine(file, match, data, franchiseeMap, brandMap);
      if (!line) continue;
      if (!file.hashavshevetCode) {
        if (!missing.has(file.supplierId)) {
          missing.set(file.supplierId, { id: file.supplierId, name: file.supplierName, code: file.supplierCode });
        }
        continue;
      }
      const existing = aggregated.get(line.key);
      if (existing) {
        existing.price += line.commission;
      } else {
        aggregated.set(line.key, {
          rowKey: line.key,
          brandId: line.franchisee.brandId,
          brandNameHe: line.brand.nameHe,
          companyId: line.brand.hashavshevetCompanyId,
          accountKey: file.hashavshevetCode,
          itemKey: line.franchisee.hashavshevetItemKey || `עמלות ${line.franchisee.name}`,
          price: line.commission,
          // ponytail: the SQL overlap filter excludes NULL periods, so "" never reaches a row.
          periodEnd: file.periodEndDate ?? "",
        });
      }
    }
  }
  const missingSuppliers = [...missing.values()].sort((a, b) => a.name.localeCompare(b.name, "he"));
  return { rows: [...aggregated.values()], missingSuppliers };
}

/**
 * "All networks" (no brand filter) → one file per brand, so each imports into
 * Hashavshevet on its own. A brand filter keeps one file with every row.
 */
function groupIntoSheets(
  rows: AggregatedRow[],
  brandIds: string[]
): { brandNameHe: string | null; rows: AggregatedRow[] }[] {
  if (rows.length === 0) return [];
  if (brandIds.length > 0) return [{ brandNameHe: null, rows }];
  const byBrand = new Map<string, { brandNameHe: string; rows: AggregatedRow[] }>();
  for (const r of rows) {
    const group = byBrand.get(r.brandId);
    if (group) group.rows.push(r);
    else byBrand.set(r.brandId, { brandNameHe: r.brandNameHe, rows: [r] });
  }
  return [...byBrand.values()];
}

/**
 * The Excel path never depends on the API mapping: without a DocumentID the row gets no apiRow,
 * and the send path's generic guard blocks it (like the other builders).
 */
function apiRowOf(row: AggregatedRow, documentNumber: string): ApiRow {
  const documentId = apiDocumentId(DOCUMENT_TYPE);
  if (documentId === null) return {};
  return {
    accountKey: row.accountKey,
    itemkey: row.itemKey,
    Quantity: apiQuantity(1),
    price: apiMoney(row.price),
    DocumentID: documentId,
    Reference: documentNumber,
  };
}

function toBuiltRow(row: AggregatedRow, documentNumber: string): BuiltRow {
  const display: Record<(typeof SUPPLIER_COMMISSIONS_HEADERS)[number], string | number> = {
    "מפתח חשבון": row.accountKey,
    "שם": "",
    "מפתח פריט": row.itemKey,
    "שם פריט": "",
    "כמות": 1,
    "מחיר": row.price,
    "סוג המסמך": DOCUMENT_TYPE,
    "מספר מסמך": documentNumber,
  };
  return {
    rowKey: row.rowKey,
    companyId: row.companyId,
    documentKey: row.rowKey,
    amount: row.price,
    display,
    apiRow: apiRowOf(row, documentNumber),
    periodEnd: row.periodEnd,
  };
}

/**
 * The Excel files' rows, numbered after aggregation. Each file restarts its
 * numbering from startDocNumber (matches Reut's manual per-network exports).
 */
export function buildSupplierCommissionsSheets(
  data: SupplierCommissionsData
): { sheets: SupplierCommissionsSheet[]; missingSuppliers: MissingSupplier[] } {
  const { rows, missingSuppliers } = aggregate(data);
  const sheets = groupIntoSheets(rows, data.brandIds).map((sheet) => ({
    brandNameHe: sheet.brandNameHe,
    rows: sheet.rows.map((r, i) => toBuiltRow(r, String(data.startDocNumber + i))),
  }));
  return { sheets, missingSuppliers };
}

/** The Excel route answers 400 with the supplier list; the API path reports it as a blocking error. */
export function buildSupplierCommissionsRows(
  data: SupplierCommissionsData
): { rows: BuiltRow[]; blockingErrors: string[] } {
  const { sheets, missingSuppliers } = buildSupplierCommissionsSheets(data);
  if (missingSuppliers.length > 0) {
    const names = missingSuppliers.map((s) => s.name).join(", ");
    return { rows: [], blockingErrors: [`${MISSING_CODE_MESSAGE}: ${names}`] };
  }
  return { rows: sheets.flatMap((sheet) => sheet.rows), blockingErrors: [] };
}

export const supplierCommissionsExport: ExportDefinition = {
  type: "supplier_commissions",
  plugin: "imovein",
  labelHe: exportLabels.supplier_commissions,
  build: async (params) => {
    const { brandIds = [], supplierIds = [], ...rest } = supplierCommissionsParams.parse(params);
    const data = await loadSupplierCommissionsData({ ...rest, brandIds, supplierIds });
    return buildSupplierCommissionsRows(data);
  },
};
