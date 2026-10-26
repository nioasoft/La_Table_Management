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

/**
 * Supplier commissions export ("עמלות ספקים לפי רשת"): the data shared by the
 * Excel route (reports/hashavshevet/export) and the Hashavshevet API send path.
 * Queries moved out of the route verbatim.
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
      })
      .from(brand),
  ]);

  // Empty when the flag is off.
  const approvedKeys = params.onlyApproved
    ? await readApprovedKeys(params.startDate, params.endDate)
    : new Set<string>();

  return { ...params, files, franchisees, brands, approvedKeys };
}
