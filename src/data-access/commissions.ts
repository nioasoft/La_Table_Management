import { database } from "@/db";
import {
  commission,
  supplier,
  franchisee,
  brand,
  type Commission,
  type Brand,
  type CreateCommissionData,
  type UpdateCommissionData,
  type CommissionStatus,
} from "@/db/schema";
import { eq, and, gte, lte, desc, sql, asc, inArray } from "drizzle-orm";
import { calculateCommission, roundToTwoDecimals } from "@/lib/file-processor";
import {
  logCommissionStatusChange,
  logAuditEvent,
  type AuditContext,
} from "./auditLog";

// Types for commission report data
export interface CommissionWithDetails extends Commission {
  supplierName: string;
  supplierCode: string;
  franchiseeName: string;
  franchiseeCode: string;
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
}

export interface CommissionReportFilters {
  startDate?: string;
  endDate?: string;
  supplierId?: string;
  brandId?: string;
  status?: string;
}

export interface CommissionSummaryByBrand {
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

export interface CommissionSummaryByPeriod {
  periodStartDate: string;
  periodEndDate: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
}

export interface CommissionSummaryBySupplier {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

export interface CommissionReportData {
  summary: {
    totalCommissions: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCommissionAmount: number;
    avgCommissionRate: number;
    periodRange: {
      startDate: string | null;
      endDate: string | null;
    };
    generatedAt: string;
  };
  byBrand: CommissionSummaryByBrand[];
  byPeriod: CommissionSummaryByPeriod[];
  bySupplier: CommissionSummaryBySupplier[];
  details: CommissionWithDetails[];
}

/**
 * Get all commissions with details for the report
 * Includes supplier, franchisee, and brand information
 */
export async function getCommissionsWithDetails(
  filters: CommissionReportFilters
): Promise<CommissionWithDetails[]> {
  const conditions = [];

  if (filters.startDate) {
    conditions.push(gte(commission.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(commission.periodEndDate, filters.endDate));
  }

  if (filters.supplierId) {
    conditions.push(eq(commission.supplierId, filters.supplierId));
  }

  if (filters.status) {
    conditions.push(eq(commission.status, filters.status as Commission["status"]));
  }

  // Filter by brandId in SQL (optimized - avoids in-memory filtering)
  if (filters.brandId) {
    conditions.push(eq(franchisee.brandId, filters.brandId));
  }

  const results = await database
    .select({
      // Commission fields
      id: commission.id,
      supplierId: commission.supplierId,
      franchiseeId: commission.franchiseeId,
      settlementPeriodId: commission.settlementPeriodId,
      periodStartDate: commission.periodStartDate,
      periodEndDate: commission.periodEndDate,
      status: commission.status,
      grossAmount: commission.grossAmount,
      netAmount: commission.netAmount,
      vatAdjusted: commission.vatAdjusted,
      commissionRate: commission.commissionRate,
      commissionAmount: commission.commissionAmount,
      invoiceNumber: commission.invoiceNumber,
      invoiceDate: commission.invoiceDate,
      notes: commission.notes,
      metadata: commission.metadata,
      calculatedAt: commission.calculatedAt,
      approvedAt: commission.approvedAt,
      approvedBy: commission.approvedBy,
      paidAt: commission.paidAt,
      createdAt: commission.createdAt,
      updatedAt: commission.updatedAt,
      createdBy: commission.createdBy,
      // Joined fields
      supplierName: supplier.name,
      supplierCode: supplier.code,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      brandId: franchisee.brandId,
      brandNameHe: brand.nameHe,
      brandNameEn: brand.nameEn,
    })
    .from(commission)
    .innerJoin(supplier, eq(commission.supplierId, supplier.id))
    .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
    .innerJoin(brand, eq(franchisee.brandId, brand.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(commission.periodStartDate), asc(supplier.name), asc(franchisee.name));

  return results as CommissionWithDetails[];
}

/**
 * Get commission summary grouped by brand
 */
export async function getCommissionSummaryByBrand(
  filters: CommissionReportFilters
): Promise<CommissionSummaryByBrand[]> {
  const conditions = [];

  if (filters.startDate) {
    conditions.push(gte(commission.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(commission.periodEndDate, filters.endDate));
  }

  if (filters.supplierId) {
    conditions.push(eq(commission.supplierId, filters.supplierId));
  }

  if (filters.status) {
    conditions.push(eq(commission.status, filters.status as Commission["status"]));
  }

  if (filters.brandId) {
    conditions.push(eq(franchisee.brandId, filters.brandId));
  }

  const results = await database
    .select({
      brandId: brand.id,
      brandNameHe: brand.nameHe,
      brandNameEn: brand.nameEn,
      commissionCount: sql<number>`count(${commission.id})::int`,
      totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
      totalNetAmount: sql<number>`coalesce(sum(${commission.netAmount}::numeric), 0)::numeric`,
      totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
      avgCommissionRate: sql<number>`coalesce(avg(${commission.commissionRate}::numeric), 0)::numeric`,
    })
    .from(commission)
    .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
    .innerJoin(brand, eq(franchisee.brandId, brand.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(brand.id, brand.nameHe, brand.nameEn)
    .orderBy(desc(sql`sum(${commission.commissionAmount}::numeric)`));

  return results.map((r) => ({
    ...r,
    totalGrossAmount: Number(r.totalGrossAmount),
    totalNetAmount: Number(r.totalNetAmount),
    totalCommissionAmount: Number(r.totalCommissionAmount),
    avgCommissionRate: Number(r.avgCommissionRate),
  }));
}

/**
 * Get commission summary grouped by period
 */
export async function getCommissionSummaryByPeriod(
  filters: CommissionReportFilters
): Promise<CommissionSummaryByPeriod[]> {
  const conditions = [];

  if (filters.startDate) {
    conditions.push(gte(commission.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(commission.periodEndDate, filters.endDate));
  }

  if (filters.supplierId) {
    conditions.push(eq(commission.supplierId, filters.supplierId));
  }

  if (filters.status) {
    conditions.push(eq(commission.status, filters.status as Commission["status"]));
  }

  // For brand filtering, we need to join with franchisee
  const baseQuery = filters.brandId
    ? database
        .select({
          periodStartDate: commission.periodStartDate,
          periodEndDate: commission.periodEndDate,
          commissionCount: sql<number>`count(${commission.id})::int`,
          totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
          totalNetAmount: sql<number>`coalesce(sum(${commission.netAmount}::numeric), 0)::numeric`,
          totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
        })
        .from(commission)
        .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
        .where(
          conditions.length > 0
            ? and(...conditions, eq(franchisee.brandId, filters.brandId))
            : eq(franchisee.brandId, filters.brandId)
        )
        .groupBy(commission.periodStartDate, commission.periodEndDate)
        .orderBy(desc(commission.periodStartDate))
    : database
        .select({
          periodStartDate: commission.periodStartDate,
          periodEndDate: commission.periodEndDate,
          commissionCount: sql<number>`count(${commission.id})::int`,
          totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
          totalNetAmount: sql<number>`coalesce(sum(${commission.netAmount}::numeric), 0)::numeric`,
          totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
        })
        .from(commission)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(commission.periodStartDate, commission.periodEndDate)
        .orderBy(desc(commission.periodStartDate));

  const results = await baseQuery;

  return results.map((r) => ({
    periodStartDate: r.periodStartDate,
    periodEndDate: r.periodEndDate,
    commissionCount: r.commissionCount,
    totalGrossAmount: Number(r.totalGrossAmount),
    totalNetAmount: Number(r.totalNetAmount),
    totalCommissionAmount: Number(r.totalCommissionAmount),
  }));
}

/**
 * Get commission summary grouped by supplier
 */
export async function getCommissionSummaryBySupplier(
  filters: CommissionReportFilters
): Promise<CommissionSummaryBySupplier[]> {
  const conditions = [];

  if (filters.startDate) {
    conditions.push(gte(commission.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(commission.periodEndDate, filters.endDate));
  }

  if (filters.supplierId) {
    conditions.push(eq(commission.supplierId, filters.supplierId));
  }

  if (filters.status) {
    conditions.push(eq(commission.status, filters.status as Commission["status"]));
  }

  // For brand filtering, we need to join with franchisee
  const baseQuery = filters.brandId
    ? database
        .select({
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierCode: supplier.code,
          commissionCount: sql<number>`count(${commission.id})::int`,
          totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
          totalNetAmount: sql<number>`coalesce(sum(${commission.netAmount}::numeric), 0)::numeric`,
          totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
          avgCommissionRate: sql<number>`coalesce(avg(${commission.commissionRate}::numeric), 0)::numeric`,
        })
        .from(commission)
        .innerJoin(supplier, eq(commission.supplierId, supplier.id))
        .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
        .where(
          conditions.length > 0
            ? and(...conditions, eq(franchisee.brandId, filters.brandId))
            : eq(franchisee.brandId, filters.brandId)
        )
        .groupBy(supplier.id, supplier.name, supplier.code)
        .orderBy(desc(sql`sum(${commission.commissionAmount}::numeric)`))
    : database
        .select({
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierCode: supplier.code,
          commissionCount: sql<number>`count(${commission.id})::int`,
          totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
          totalNetAmount: sql<number>`coalesce(sum(${commission.netAmount}::numeric), 0)::numeric`,
          totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
          avgCommissionRate: sql<number>`coalesce(avg(${commission.commissionRate}::numeric), 0)::numeric`,
        })
        .from(commission)
        .innerJoin(supplier, eq(commission.supplierId, supplier.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(supplier.id, supplier.name, supplier.code)
        .orderBy(desc(sql`sum(${commission.commissionAmount}::numeric)`));

  const results = await baseQuery;

  return results.map((r) => ({
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    supplierCode: r.supplierCode,
    commissionCount: r.commissionCount,
    totalGrossAmount: Number(r.totalGrossAmount),
    totalNetAmount: Number(r.totalNetAmount),
    totalCommissionAmount: Number(r.totalCommissionAmount),
    avgCommissionRate: Number(r.avgCommissionRate),
  }));
}

/**
 * Get complete commission report data
 * Includes summary, breakdown by brand, period, supplier, and detailed list
 */
export async function getCommissionReportData(
  filters: CommissionReportFilters
): Promise<CommissionReportData> {
  // Fetch all data in parallel
  const [details, byBrand, byPeriod, bySupplier] = await Promise.all([
    getCommissionsWithDetails(filters),
    getCommissionSummaryByBrand(filters),
    getCommissionSummaryByPeriod(filters),
    getCommissionSummaryBySupplier(filters),
  ]);

  // Calculate overall summary from details
  const totalCommissions = details.length;
  const totalGrossAmount = details.reduce(
    (sum, c) => sum + Number(c.grossAmount || 0),
    0
  );
  const totalNetAmount = details.reduce(
    (sum, c) => sum + Number(c.netAmount || 0),
    0
  );
  const totalCommissionAmount = details.reduce(
    (sum, c) => sum + Number(c.commissionAmount || 0),
    0
  );
  const avgCommissionRate =
    totalCommissions > 0
      ? details.reduce((sum, c) => sum + Number(c.commissionRate || 0), 0) /
        totalCommissions
      : 0;

  // Get period range
  const periodDates = details.map((c) => ({
    start: c.periodStartDate,
    end: c.periodEndDate,
  }));
  const startDate =
    periodDates.length > 0
      ? periodDates.reduce(
          (min, d) => (d.start < min ? d.start : min),
          periodDates[0].start
        )
      : null;
  const endDate =
    periodDates.length > 0
      ? periodDates.reduce(
          (max, d) => (d.end > max ? d.end : max),
          periodDates[0].end
        )
      : null;

  return {
    summary: {
      totalCommissions,
      totalGrossAmount,
      totalNetAmount,
      totalCommissionAmount,
      avgCommissionRate,
      periodRange: {
        startDate,
        endDate,
      },
      generatedAt: new Date().toISOString(),
    },
    byBrand,
    byPeriod,
    bySupplier,
    details,
  };
}

/**
 * Get all brands for filter dropdown
 */
export async function getAllBrands(): Promise<Brand[]> {
  const results = await database
    .select()
    .from(brand)
    .where(eq(brand.isActive, true))
    .orderBy(asc(brand.nameHe));

  return results as Brand[];
}

// ============================================================================
// PER-SUPPLIER COMMISSION REPORT TYPES AND FUNCTIONS
// ============================================================================

export interface SupplierFranchiseeCommission {
  franchiseeId: string;
  franchiseeName: string;
  franchiseeCode: string;
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

export interface SupplierCommissionPeriod {
  periodStartDate: string;
  periodEndDate: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
}

export interface PerSupplierReportFilters {
  supplierId: string;
  startDate?: string;
  endDate?: string;
  brandId?: string;
  status?: string;
  compareStartDate?: string;
  compareEndDate?: string;
}

export interface PerSupplierReportData {
  supplier: {
    id: string;
    name: string;
    code: string;
    defaultCommissionRate: string | null;
    commissionType: string | null;
    settlementFrequency: string | null;
    vatIncluded: boolean | null;
  };
  summary: {
    totalFranchisees: number;
    totalCommissions: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCommissionAmount: number;
    avgCommissionRate: number;
    periodRange: {
      startDate: string | null;
      endDate: string | null;
    };
    generatedAt: string;
  };
  byFranchisee: SupplierFranchiseeCommission[];
  byPeriod: SupplierCommissionPeriod[];
  details: CommissionWithDetails[];
  // Historical comparison data (if compare dates provided)
  comparison?: {
    previousPeriod: {
      totalGrossAmount: number;
      totalNetAmount: number;
      totalCommissionAmount: number;
      commissionCount: number;
    };
    changes: {
      grossAmountChange: number;
      grossAmountChangePercent: number;
      netAmountChange: number;
      netAmountChangePercent: number;
      commissionAmountChange: number;
      commissionAmountChangePercent: number;
    };
  };
}

/**
 * Get commission details for a specific supplier
 */
export async function getSupplierCommissionsWithDetails(
  filters: PerSupplierReportFilters
): Promise<CommissionWithDetails[]> {
  const conditions = [eq(commission.supplierId, filters.supplierId)];

  if (filters.startDate) {
    conditions.push(gte(commission.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(commission.periodEndDate, filters.endDate));
  }

  if (filters.status) {
    conditions.push(eq(commission.status, filters.status as Commission["status"]));
  }

  // Filter by brandId in SQL (optimized - avoids in-memory filtering)
  if (filters.brandId) {
    conditions.push(eq(franchisee.brandId, filters.brandId));
  }

  const results = await database
    .select({
      // Commission fields
      id: commission.id,
      supplierId: commission.supplierId,
      franchiseeId: commission.franchiseeId,
      settlementPeriodId: commission.settlementPeriodId,
      periodStartDate: commission.periodStartDate,
      periodEndDate: commission.periodEndDate,
      status: commission.status,
      grossAmount: commission.grossAmount,
      netAmount: commission.netAmount,
      vatAdjusted: commission.vatAdjusted,
      commissionRate: commission.commissionRate,
      commissionAmount: commission.commissionAmount,
      invoiceNumber: commission.invoiceNumber,
      invoiceDate: commission.invoiceDate,
      notes: commission.notes,
      metadata: commission.metadata,
      calculatedAt: commission.calculatedAt,
      approvedAt: commission.approvedAt,
      approvedBy: commission.approvedBy,
      paidAt: commission.paidAt,
      createdAt: commission.createdAt,
      updatedAt: commission.updatedAt,
      createdBy: commission.createdBy,
      // Joined fields
      supplierName: supplier.name,
      supplierCode: supplier.code,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      brandId: franchisee.brandId,
      brandNameHe: brand.nameHe,
      brandNameEn: brand.nameEn,
    })
    .from(commission)
    .innerJoin(supplier, eq(commission.supplierId, supplier.id))
    .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
    .innerJoin(brand, eq(franchisee.brandId, brand.id))
    .where(and(...conditions))
    .orderBy(desc(commission.periodStartDate), asc(franchisee.name));

  return results as CommissionWithDetails[];
}

/**
 * Get commission summary grouped by franchisee for a specific supplier
 */
export async function getSupplierCommissionsByFranchisee(
  filters: PerSupplierReportFilters
): Promise<SupplierFranchiseeCommission[]> {
  const conditions = [eq(commission.supplierId, filters.supplierId)];

  if (filters.startDate) {
    conditions.push(gte(commission.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(commission.periodEndDate, filters.endDate));
  }

  if (filters.status) {
    conditions.push(eq(commission.status, filters.status as Commission["status"]));
  }

  if (filters.brandId) {
    conditions.push(eq(franchisee.brandId, filters.brandId));
  }

  const results = await database
    .select({
      franchiseeId: franchisee.id,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      brandId: brand.id,
      brandNameHe: brand.nameHe,
      brandNameEn: brand.nameEn,
      commissionCount: sql<number>`count(${commission.id})::int`,
      totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
      totalNetAmount: sql<number>`coalesce(sum(${commission.netAmount}::numeric), 0)::numeric`,
      totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
      avgCommissionRate: sql<number>`coalesce(avg(${commission.commissionRate}::numeric), 0)::numeric`,
    })
    .from(commission)
    .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
    .innerJoin(brand, eq(franchisee.brandId, brand.id))
    .where(and(...conditions))
    .groupBy(franchisee.id, franchisee.name, franchisee.code, brand.id, brand.nameHe, brand.nameEn)
    .orderBy(desc(sql`sum(${commission.commissionAmount}::numeric)`));

  return results.map((r) => ({
    franchiseeId: r.franchiseeId,
    franchiseeName: r.franchiseeName,
    franchiseeCode: r.franchiseeCode,
    brandId: r.brandId,
    brandNameHe: r.brandNameHe,
    brandNameEn: r.brandNameEn,
    commissionCount: r.commissionCount,
    totalGrossAmount: Number(r.totalGrossAmount),
    totalNetAmount: Number(r.totalNetAmount),
    totalCommissionAmount: Number(r.totalCommissionAmount),
    avgCommissionRate: Number(r.avgCommissionRate),
  }));
}

/**
 * Get commission summary grouped by period for a specific supplier
 */
export async function getSupplierCommissionsByPeriod(
  filters: PerSupplierReportFilters
): Promise<SupplierCommissionPeriod[]> {
  const conditions = [eq(commission.supplierId, filters.supplierId)];

  if (filters.startDate) {
    conditions.push(gte(commission.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(commission.periodEndDate, filters.endDate));
  }

  if (filters.status) {
    conditions.push(eq(commission.status, filters.status as Commission["status"]));
  }

  if (filters.brandId) {
    conditions.push(eq(franchisee.brandId, filters.brandId));
  }

  const baseQuery = filters.brandId
    ? database
        .select({
          periodStartDate: commission.periodStartDate,
          periodEndDate: commission.periodEndDate,
          commissionCount: sql<number>`count(${commission.id})::int`,
          totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
          totalNetAmount: sql<number>`coalesce(sum(${commission.netAmount}::numeric), 0)::numeric`,
          totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
        })
        .from(commission)
        .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
        .where(and(...conditions))
        .groupBy(commission.periodStartDate, commission.periodEndDate)
        .orderBy(desc(commission.periodStartDate))
    : database
        .select({
          periodStartDate: commission.periodStartDate,
          periodEndDate: commission.periodEndDate,
          commissionCount: sql<number>`count(${commission.id})::int`,
          totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
          totalNetAmount: sql<number>`coalesce(sum(${commission.netAmount}::numeric), 0)::numeric`,
          totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
        })
        .from(commission)
        .where(and(...conditions))
        .groupBy(commission.periodStartDate, commission.periodEndDate)
        .orderBy(desc(commission.periodStartDate));

  const results = await baseQuery;

  return results.map((r) => ({
    periodStartDate: r.periodStartDate,
    periodEndDate: r.periodEndDate,
    commissionCount: r.commissionCount,
    totalGrossAmount: Number(r.totalGrossAmount),
    totalNetAmount: Number(r.totalNetAmount),
    totalCommissionAmount: Number(r.totalCommissionAmount),
  }));
}

/**
 * Get historical comparison data for a supplier
 */
export async function getSupplierHistoricalComparison(
  supplierId: string,
  compareStartDate: string,
  compareEndDate: string,
  brandId?: string
): Promise<{
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  commissionCount: number;
}> {
  const conditions = [
    eq(commission.supplierId, supplierId),
    gte(commission.periodStartDate, compareStartDate),
    lte(commission.periodEndDate, compareEndDate),
  ];

  if (brandId) {
    conditions.push(eq(franchisee.brandId, brandId));
  }

  const query = brandId
    ? database
        .select({
          totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
          totalNetAmount: sql<number>`coalesce(sum(${commission.netAmount}::numeric), 0)::numeric`,
          totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
          commissionCount: sql<number>`count(${commission.id})::int`,
        })
        .from(commission)
        .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
        .where(and(...conditions))
    : database
        .select({
          totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
          totalNetAmount: sql<number>`coalesce(sum(${commission.netAmount}::numeric), 0)::numeric`,
          totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
          commissionCount: sql<number>`count(${commission.id})::int`,
        })
        .from(commission)
        .where(and(...conditions));

  const results = await query;
  const result = results[0];

  return {
    totalGrossAmount: Number(result?.totalGrossAmount || 0),
    totalNetAmount: Number(result?.totalNetAmount || 0),
    totalCommissionAmount: Number(result?.totalCommissionAmount || 0),
    commissionCount: result?.commissionCount || 0,
  };
}

/**
 * Get complete per-supplier commission report data
 * Includes summary, breakdown by franchisee, period, details, and optional historical comparison
 */
export async function getPerSupplierReportData(
  filters: PerSupplierReportFilters
): Promise<PerSupplierReportData | null> {
  // Fetch supplier info
  const supplierResult = await database
    .select({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      defaultCommissionRate: supplier.defaultCommissionRate,
      commissionType: supplier.commissionType,
      settlementFrequency: supplier.settlementFrequency,
      vatIncluded: supplier.vatIncluded,
    })
    .from(supplier)
    .where(eq(supplier.id, filters.supplierId))
    .limit(1);

  if (supplierResult.length === 0) {
    return null;
  }

  const supplierInfo = supplierResult[0];

  // Fetch all data in parallel
  const [details, byFranchisee, byPeriod] = await Promise.all([
    getSupplierCommissionsWithDetails(filters),
    getSupplierCommissionsByFranchisee(filters),
    getSupplierCommissionsByPeriod(filters),
  ]);

  // Calculate overall summary from details
  const totalCommissions = details.length;
  const uniqueFranchisees = new Set(details.map((d) => d.franchiseeId)).size;
  const totalGrossAmount = details.reduce(
    (sum, c) => sum + Number(c.grossAmount || 0),
    0
  );
  const totalNetAmount = details.reduce(
    (sum, c) => sum + Number(c.netAmount || 0),
    0
  );
  const totalCommissionAmount = details.reduce(
    (sum, c) => sum + Number(c.commissionAmount || 0),
    0
  );
  const avgCommissionRate =
    totalCommissions > 0
      ? details.reduce((sum, c) => sum + Number(c.commissionRate || 0), 0) /
        totalCommissions
      : 0;

  // Get period range
  const periodDates = details.map((c) => ({
    start: c.periodStartDate,
    end: c.periodEndDate,
  }));
  const startDate =
    periodDates.length > 0
      ? periodDates.reduce(
          (min, d) => (d.start < min ? d.start : min),
          periodDates[0].start
        )
      : null;
  const endDate =
    periodDates.length > 0
      ? periodDates.reduce(
          (max, d) => (d.end > max ? d.end : max),
          periodDates[0].end
        )
      : null;

  // Build report data
  const reportData: PerSupplierReportData = {
    supplier: supplierInfo,
    summary: {
      totalFranchisees: uniqueFranchisees,
      totalCommissions,
      totalGrossAmount,
      totalNetAmount,
      totalCommissionAmount,
      avgCommissionRate,
      periodRange: {
        startDate,
        endDate,
      },
      generatedAt: new Date().toISOString(),
    },
    byFranchisee,
    byPeriod,
    details,
  };

  // Add historical comparison if compare dates provided
  if (filters.compareStartDate && filters.compareEndDate) {
    const previousPeriod = await getSupplierHistoricalComparison(
      filters.supplierId,
      filters.compareStartDate,
      filters.compareEndDate,
      filters.brandId
    );

    const grossAmountChange = totalGrossAmount - previousPeriod.totalGrossAmount;
    const netAmountChange = totalNetAmount - previousPeriod.totalNetAmount;
    const commissionAmountChange = totalCommissionAmount - previousPeriod.totalCommissionAmount;

    reportData.comparison = {
      previousPeriod,
      changes: {
        grossAmountChange,
        grossAmountChangePercent:
          previousPeriod.totalGrossAmount > 0
            ? (grossAmountChange / previousPeriod.totalGrossAmount) * 100
            : 0,
        netAmountChange,
        netAmountChangePercent:
          previousPeriod.totalNetAmount > 0
            ? (netAmountChange / previousPeriod.totalNetAmount) * 100
            : 0,
        commissionAmountChange,
        commissionAmountChangePercent:
          previousPeriod.totalCommissionAmount > 0
            ? (commissionAmountChange / previousPeriod.totalCommissionAmount) * 100
            : 0,
      },
    };
  }

  return reportData;
}

// ============================================================================
// COMMISSION STATUS LIFECYCLE
// ============================================================================

/**
 * Valid status transitions for commission lifecycle
 * The commission follows this lifecycle:
 * pending -> calculated -> approved -> paid
 *
 * Transitions:
 * - pending: Initial state when commission is created
 * - calculated: Commission amount has been calculated
 * - approved: Commission has been approved
 * - paid: Commission has been paid
 * - cancelled: Commission has been cancelled (can happen from pending/calculated)
 */
export const COMMISSION_STATUS_TRANSITIONS: Record<CommissionStatus, CommissionStatus[]> = {
  pending: ["calculated", "cancelled"],
  calculated: ["approved", "pending", "cancelled"],
  approved: ["paid", "calculated", "cancelled"],
  paid: [], // Terminal state - no transitions allowed
  cancelled: [], // Terminal state - no transitions allowed
};

/**
 * Check if a commission status transition is valid
 */
export function isValidCommissionStatusTransition(
  currentStatus: CommissionStatus,
  newStatus: CommissionStatus
): boolean {
  const allowedTransitions = COMMISSION_STATUS_TRANSITIONS[currentStatus];
  return allowedTransitions?.includes(newStatus) ?? false;
}

/**
 * Get allowed next statuses for a given commission status
 */
export function getAllowedNextCommissionStatuses(currentStatus: CommissionStatus): CommissionStatus[] {
  return COMMISSION_STATUS_TRANSITIONS[currentStatus] ?? [];
}

// ============================================================================
// COMMISSION CRUD OPERATIONS
// ============================================================================

/**
 * Get a single commission by ID
 */
export async function getCommissionById(id: string): Promise<Commission | null> {
  const results = await database
    .select()
    .from(commission)
    .where(eq(commission.id, id))
    .limit(1);
  return (results[0] as Commission) || null;
}

/**
 * Get commission with full details by ID
 */
export async function getCommissionWithDetailsById(id: string): Promise<CommissionWithDetails | null> {
  const results = await database
    .select({
      // Commission fields
      id: commission.id,
      supplierId: commission.supplierId,
      franchiseeId: commission.franchiseeId,
      settlementPeriodId: commission.settlementPeriodId,
      periodStartDate: commission.periodStartDate,
      periodEndDate: commission.periodEndDate,
      status: commission.status,
      grossAmount: commission.grossAmount,
      netAmount: commission.netAmount,
      vatAdjusted: commission.vatAdjusted,
      commissionRate: commission.commissionRate,
      commissionAmount: commission.commissionAmount,
      invoiceNumber: commission.invoiceNumber,
      invoiceDate: commission.invoiceDate,
      notes: commission.notes,
      metadata: commission.metadata,
      calculatedAt: commission.calculatedAt,
      approvedAt: commission.approvedAt,
      approvedBy: commission.approvedBy,
      paidAt: commission.paidAt,
      createdAt: commission.createdAt,
      updatedAt: commission.updatedAt,
      createdBy: commission.createdBy,
      // Joined fields
      supplierName: supplier.name,
      supplierCode: supplier.code,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      brandId: franchisee.brandId,
      brandNameHe: brand.nameHe,
      brandNameEn: brand.nameEn,
    })
    .from(commission)
    .innerJoin(supplier, eq(commission.supplierId, supplier.id))
    .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
    .innerJoin(brand, eq(franchisee.brandId, brand.id))
    .where(eq(commission.id, id))
    .limit(1);

  return (results[0] as CommissionWithDetails) || null;
}

/**
 * Create a new commission record
 */
export async function createCommission(data: CreateCommissionData): Promise<Commission> {
  const [newCommission] = await database
    .insert(commission)
    .values(data)
    .returning();
  return newCommission as Commission;
}

/**
 * Update an existing commission
 */
export async function updateCommission(
  id: string,
  data: UpdateCommissionData
): Promise<Commission | null> {
  const results = await database
    .update(commission)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(commission.id, id))
    .returning();

  return (results[0] as Commission) || null;
}

/**
 * Delete a commission
 */
export async function deleteCommission(id: string): Promise<boolean> {
  const result = await database
    .delete(commission)
    .where(eq(commission.id, id));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Get commissions by supplier ID
 */
export async function getCommissionsBySupplierId(supplierId: string): Promise<Commission[]> {
  return database
    .select()
    .from(commission)
    .where(eq(commission.supplierId, supplierId))
    .orderBy(desc(commission.createdAt)) as unknown as Promise<Commission[]>;
}

/**
 * Get commissions by status
 */
export async function getCommissionsByStatus(status: CommissionStatus): Promise<Commission[]> {
  return database
    .select()
    .from(commission)
    .where(eq(commission.status, status))
    .orderBy(desc(commission.createdAt)) as unknown as Promise<Commission[]>;
}

// ============================================================================
// COMMISSION CALCULATION FUNCTIONS
// ============================================================================

/**
 * Input data for calculating a commission
 */
export interface CommissionCalculationInput {
  supplierId: string;
  franchiseeId: string;
  periodStartDate: string;
  periodEndDate: string;
  grossAmount: number;
  netAmount: number;
  vatAdjusted: boolean;
  settlementPeriodId?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  createdBy?: string;
}

/**
 * Result of commission calculation
 */
export interface CommissionCalculationResult {
  success: boolean;
  commission?: Commission;
  error?: string;
}

/**
 * Calculate and create a commission record for a single franchisee transaction
 * Uses the supplier's commission rate and calculates based on net amount (before VAT)
 */
export async function calculateAndCreateCommission(
  input: CommissionCalculationInput,
  auditContext?: AuditContext
): Promise<CommissionCalculationResult> {
  try {
    // Get supplier to retrieve commission rate
    const supplierResult = await database
      .select({
        id: supplier.id,
        name: supplier.name,
        defaultCommissionRate: supplier.defaultCommissionRate,
        commissionType: supplier.commissionType,
      })
      .from(supplier)
      .where(eq(supplier.id, input.supplierId))
      .limit(1);

    if (supplierResult.length === 0) {
      return { success: false, error: "Supplier not found" };
    }

    const supplierData = supplierResult[0];

    if (!supplierData.defaultCommissionRate) {
      return { success: false, error: "Supplier does not have a commission rate configured" };
    }

    const commissionRate = parseFloat(supplierData.defaultCommissionRate);
    const commissionType = supplierData.commissionType || "percentage";

    // Calculate commission based on net amount (before VAT)
    const commissionAmount = calculateCommission(
      input.netAmount,
      commissionRate,
      commissionType
    );

    // Create the commission record with status "calculated"
    const commissionData: CreateCommissionData = {
      id: crypto.randomUUID(),
      supplierId: input.supplierId,
      franchiseeId: input.franchiseeId,
      settlementPeriodId: input.settlementPeriodId || null,
      periodStartDate: input.periodStartDate,
      periodEndDate: input.periodEndDate,
      status: "calculated",
      grossAmount: roundToTwoDecimals(input.grossAmount).toString(),
      netAmount: roundToTwoDecimals(input.netAmount).toString(),
      vatAdjusted: input.vatAdjusted,
      commissionRate: commissionRate.toString(),
      commissionAmount: commissionAmount.toString(),
      notes: input.notes || null,
      metadata: input.metadata || null,
      calculatedAt: new Date(),
      createdBy: input.createdBy || null,
    };

    const newCommission = await createCommission(commissionData);

    // Log the commission creation if audit context provided
    if (auditContext) {
      await logAuditEvent(auditContext, "create", "commission", newCommission.id, {
        entityName: `${supplierData.name} commission`,
        afterValue: {
          grossAmount: commissionData.grossAmount,
          netAmount: commissionData.netAmount,
          commissionRate: commissionData.commissionRate,
          commissionAmount: commissionData.commissionAmount,
          status: "calculated",
        },
      });
    }

    return { success: true, commission: newCommission };
  } catch (error) {
    console.error("Error calculating commission:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Batch input for calculating commissions
 */
export interface BatchCommissionInput {
  supplierId: string;
  periodStartDate: string;
  periodEndDate: string;
  settlementPeriodId?: string;
  transactions: Array<{
    franchiseeId: string;
    grossAmount: number;
    netAmount: number;
    vatAdjusted: boolean;
    notes?: string;
    metadata?: Record<string, unknown>;
  }>;
  createdBy?: string;
}

/**
 * Result of batch commission calculation
 */
export interface BatchCommissionResult {
  success: boolean;
  totalCreated: number;
  totalFailed: number;
  commissions: Commission[];
  errors: Array<{ franchiseeId: string; error: string }>;
  summary: {
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCommissionAmount: number;
    averageCommissionRate: number;
  };
}

/**
 * Calculate and create commission records for multiple transactions in batch
 * All transactions must be for the same supplier
 */
export async function calculateBatchCommissions(
  input: BatchCommissionInput,
  auditContext?: AuditContext
): Promise<BatchCommissionResult> {
  const commissions: Commission[] = [];
  const errors: Array<{ franchiseeId: string; error: string }> = [];

  let totalGrossAmount = 0;
  let totalNetAmount = 0;
  let totalCommissionAmount = 0;
  let totalCommissionRate = 0;

  for (const transaction of input.transactions) {
    const result = await calculateAndCreateCommission(
      {
        supplierId: input.supplierId,
        franchiseeId: transaction.franchiseeId,
        periodStartDate: input.periodStartDate,
        periodEndDate: input.periodEndDate,
        grossAmount: transaction.grossAmount,
        netAmount: transaction.netAmount,
        vatAdjusted: transaction.vatAdjusted,
        settlementPeriodId: input.settlementPeriodId,
        notes: transaction.notes,
        metadata: transaction.metadata,
        createdBy: input.createdBy,
      },
      auditContext
    );

    if (result.success && result.commission) {
      commissions.push(result.commission);
      totalGrossAmount += parseFloat(result.commission.grossAmount);
      totalNetAmount += parseFloat(result.commission.netAmount || "0");
      totalCommissionAmount += parseFloat(result.commission.commissionAmount);
      totalCommissionRate += parseFloat(result.commission.commissionRate);
    } else {
      errors.push({
        franchiseeId: transaction.franchiseeId,
        error: result.error || "Unknown error",
      });
    }
  }

  return {
    success: errors.length === 0,
    totalCreated: commissions.length,
    totalFailed: errors.length,
    commissions,
    errors,
    summary: {
      totalGrossAmount: roundToTwoDecimals(totalGrossAmount),
      totalNetAmount: roundToTwoDecimals(totalNetAmount),
      totalCommissionAmount: roundToTwoDecimals(totalCommissionAmount),
      averageCommissionRate:
        commissions.length > 0
          ? roundToTwoDecimals(totalCommissionRate / commissions.length)
          : 0,
    },
  };
}

// ============================================================================
// COMMISSION STATUS MANAGEMENT
// ============================================================================

/**
 * Transition commission status with validation
 */
export async function transitionCommissionStatus(
  id: string,
  newStatus: CommissionStatus,
  auditContext?: AuditContext,
  reason?: string
): Promise<{ success: boolean; commission?: Commission; error?: string }> {
  const existingCommission = await getCommissionWithDetailsById(id);

  if (!existingCommission) {
    return { success: false, error: "Commission not found" };
  }

  const currentStatus = existingCommission.status;

  // Validate transition
  if (!isValidCommissionStatusTransition(currentStatus, newStatus)) {
    const allowedTransitions = getAllowedNextCommissionStatuses(currentStatus);
    return {
      success: false,
      error: `Invalid status transition from '${currentStatus}' to '${newStatus}'. Allowed transitions: ${allowedTransitions.join(", ") || "none"}`,
    };
  }

  // Prepare update data based on target status
  const updateData: UpdateCommissionData = { status: newStatus };

  if (newStatus === "approved") {
    updateData.approvedAt = new Date();
    if (auditContext) {
      updateData.approvedBy = auditContext.userId;
    }
  } else if (newStatus === "paid") {
    updateData.paidAt = new Date();
  } else if (newStatus === "calculated") {
    updateData.calculatedAt = new Date();
  }

  // Perform the update
  const updatedCommission = await updateCommission(id, updateData);

  if (!updatedCommission) {
    return { success: false, error: "Failed to update commission" };
  }

  // Log status change if audit context provided
  if (auditContext) {
    await logCommissionStatusChange(
      auditContext,
      id,
      existingCommission.supplierName,
      existingCommission.franchiseeName,
      currentStatus,
      newStatus,
      existingCommission.commissionAmount,
      reason
    );
  }

  return { success: true, commission: updatedCommission };
}

/**
 * Approve a commission
 */
export async function approveCommission(
  id: string,
  auditContext?: AuditContext
): Promise<{ success: boolean; commission?: Commission; error?: string }> {
  return transitionCommissionStatus(id, "approved", auditContext, "Commission approved");
}

/**
 * Mark a commission as paid
 */
export async function markCommissionAsPaid(
  id: string,
  auditContext?: AuditContext
): Promise<{ success: boolean; commission?: Commission; error?: string }> {
  return transitionCommissionStatus(id, "paid", auditContext, "Commission marked as paid");
}

/**
 * Cancel a commission
 */
export async function cancelCommission(
  id: string,
  reason: string,
  auditContext?: AuditContext
): Promise<{ success: boolean; commission?: Commission; error?: string }> {
  return transitionCommissionStatus(id, "cancelled", auditContext, reason);
}

/**
 * Bulk approve commissions
 */
export async function bulkApproveCommissions(
  ids: string[],
  auditContext?: AuditContext
): Promise<{
  success: boolean;
  approved: string[];
  failed: Array<{ id: string; error: string }>;
}> {
  const approved: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of ids) {
    const result = await approveCommission(id, auditContext);
    if (result.success) {
      approved.push(id);
    } else {
      failed.push({ id, error: result.error || "Unknown error" });
    }
  }

  return {
    success: failed.length === 0,
    approved,
    failed,
  };
}

/**
 * Bulk mark commissions as paid
 */
export async function bulkMarkCommissionsAsPaid(
  ids: string[],
  auditContext?: AuditContext
): Promise<{
  success: boolean;
  paid: string[];
  failed: Array<{ id: string; error: string }>;
}> {
  const paid: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of ids) {
    const result = await markCommissionAsPaid(id, auditContext);
    if (result.success) {
      paid.push(id);
    } else {
      failed.push({ id, error: result.error || "Unknown error" });
    }
  }

  return {
    success: failed.length === 0,
    paid,
    failed,
  };
}

// ============================================================================
// COMMISSION GROUPING BY BRAND FOR INVOICING
// ============================================================================

/**
 * Commission group by brand for invoicing
 */
export interface CommissionBrandGroup {
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  brandCode: string;
  commissions: CommissionWithDetails[];
  summary: {
    commissionCount: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCommissionAmount: number;
    avgCommissionRate: number;
  };
}

/**
 * Invoice data grouped by brand
 */
export interface CommissionInvoiceData {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  periodStartDate: string;
  periodEndDate: string;
  byBrand: CommissionBrandGroup[];
  totals: {
    totalBrands: number;
    totalCommissions: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCommissionAmount: number;
  };
  generatedAt: string;
}

/**
 * Get commissions grouped by brand for a specific supplier and period
 * Used for generating invoices
 */
export async function getCommissionsGroupedByBrand(
  supplierId: string,
  periodStartDate: string,
  periodEndDate: string,
  status?: CommissionStatus
): Promise<CommissionInvoiceData | null> {
  // Get supplier info
  const supplierResult = await database
    .select({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
    })
    .from(supplier)
    .where(eq(supplier.id, supplierId))
    .limit(1);

  if (supplierResult.length === 0) {
    return null;
  }

  const supplierInfo = supplierResult[0];

  // Build conditions
  const conditions = [
    eq(commission.supplierId, supplierId),
    gte(commission.periodStartDate, periodStartDate),
    lte(commission.periodEndDate, periodEndDate),
  ];

  if (status) {
    conditions.push(eq(commission.status, status));
  }

  // Get all commissions with details
  const results = await database
    .select({
      // Commission fields
      id: commission.id,
      supplierId: commission.supplierId,
      franchiseeId: commission.franchiseeId,
      settlementPeriodId: commission.settlementPeriodId,
      periodStartDate: commission.periodStartDate,
      periodEndDate: commission.periodEndDate,
      status: commission.status,
      grossAmount: commission.grossAmount,
      netAmount: commission.netAmount,
      vatAdjusted: commission.vatAdjusted,
      commissionRate: commission.commissionRate,
      commissionAmount: commission.commissionAmount,
      invoiceNumber: commission.invoiceNumber,
      invoiceDate: commission.invoiceDate,
      notes: commission.notes,
      metadata: commission.metadata,
      calculatedAt: commission.calculatedAt,
      approvedAt: commission.approvedAt,
      approvedBy: commission.approvedBy,
      paidAt: commission.paidAt,
      createdAt: commission.createdAt,
      updatedAt: commission.updatedAt,
      createdBy: commission.createdBy,
      // Joined fields
      supplierName: supplier.name,
      supplierCode: supplier.code,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      brandId: brand.id,
      brandCode: brand.code,
      brandNameHe: brand.nameHe,
      brandNameEn: brand.nameEn,
    })
    .from(commission)
    .innerJoin(supplier, eq(commission.supplierId, supplier.id))
    .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
    .innerJoin(brand, eq(franchisee.brandId, brand.id))
    .where(and(...conditions))
    .orderBy(asc(brand.nameHe), asc(franchisee.name));

  // Group by brand
  const brandGroups = new Map<string, CommissionBrandGroup>();

  for (const row of results) {
    const brandId = row.brandId;

    if (!brandGroups.has(brandId)) {
      brandGroups.set(brandId, {
        brandId,
        brandNameHe: row.brandNameHe,
        brandNameEn: row.brandNameEn,
        brandCode: row.brandCode,
        commissions: [],
        summary: {
          commissionCount: 0,
          totalGrossAmount: 0,
          totalNetAmount: 0,
          totalCommissionAmount: 0,
          avgCommissionRate: 0,
        },
      });
    }

    const group = brandGroups.get(brandId)!;
    group.commissions.push(row as CommissionWithDetails);
    group.summary.commissionCount++;
    group.summary.totalGrossAmount += parseFloat(row.grossAmount);
    group.summary.totalNetAmount += parseFloat(row.netAmount || "0");
    group.summary.totalCommissionAmount += parseFloat(row.commissionAmount);
    group.summary.avgCommissionRate += parseFloat(row.commissionRate);
  }

  // Calculate averages and totals
  const byBrand = Array.from(brandGroups.values()).map((group) => {
    if (group.summary.commissionCount > 0) {
      group.summary.avgCommissionRate = roundToTwoDecimals(
        group.summary.avgCommissionRate / group.summary.commissionCount
      );
      group.summary.totalGrossAmount = roundToTwoDecimals(group.summary.totalGrossAmount);
      group.summary.totalNetAmount = roundToTwoDecimals(group.summary.totalNetAmount);
      group.summary.totalCommissionAmount = roundToTwoDecimals(group.summary.totalCommissionAmount);
    }
    return group;
  });

  // Calculate overall totals
  const totals = {
    totalBrands: byBrand.length,
    totalCommissions: results.length,
    totalGrossAmount: roundToTwoDecimals(
      byBrand.reduce((sum, g) => sum + g.summary.totalGrossAmount, 0)
    ),
    totalNetAmount: roundToTwoDecimals(
      byBrand.reduce((sum, g) => sum + g.summary.totalNetAmount, 0)
    ),
    totalCommissionAmount: roundToTwoDecimals(
      byBrand.reduce((sum, g) => sum + g.summary.totalCommissionAmount, 0)
    ),
  };

  return {
    supplierId: supplierInfo.id,
    supplierName: supplierInfo.name,
    supplierCode: supplierInfo.code,
    periodStartDate,
    periodEndDate,
    byBrand,
    totals,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Update commission invoice information
 */
export async function setCommissionInvoiceInfo(
  id: string,
  invoiceNumber: string,
  invoiceDate: string,
  auditContext?: AuditContext
): Promise<{ success: boolean; commission?: Commission; error?: string }> {
  const existingCommission = await getCommissionById(id);

  if (!existingCommission) {
    return { success: false, error: "Commission not found" };
  }

  // Only allow setting invoice info for approved or paid commissions
  if (existingCommission.status !== "approved" && existingCommission.status !== "paid") {
    return {
      success: false,
      error: "Invoice info can only be set for approved or paid commissions",
    };
  }

  const updatedCommission = await updateCommission(id, {
    invoiceNumber,
    invoiceDate,
  });

  if (!updatedCommission) {
    return { success: false, error: "Failed to update commission" };
  }

  // Log the invoice info update if audit context provided
  if (auditContext) {
    await logAuditEvent(auditContext, "update", "commission", id, {
      beforeValue: {
        invoiceNumber: existingCommission.invoiceNumber,
        invoiceDate: existingCommission.invoiceDate,
      },
      afterValue: { invoiceNumber, invoiceDate },
      notes: "Invoice information updated",
    });
  }

  return { success: true, commission: updatedCommission };
}

/**
 * Bulk set invoice info for multiple commissions
 */
export async function bulkSetCommissionInvoiceInfo(
  ids: string[],
  invoiceNumber: string,
  invoiceDate: string,
  auditContext?: AuditContext
): Promise<{
  success: boolean;
  updated: string[];
  failed: Array<{ id: string; error: string }>;
}> {
  const updated: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of ids) {
    const result = await setCommissionInvoiceInfo(id, invoiceNumber, invoiceDate, auditContext);
    if (result.success) {
      updated.push(id);
    } else {
      failed.push({ id, error: result.error || "Unknown error" });
    }
  }

  return {
    success: failed.length === 0,
    updated,
    failed,
  };
}

/**
 * Get pending commissions for approval (status = calculated)
 */
export async function getPendingApprovalsWithDetails(): Promise<CommissionWithDetails[]> {
  return getCommissionsWithDetails({ status: "calculated" });
}

/**
 * Get approved commissions ready for invoicing
 */
export async function getApprovedCommissionsForInvoicing(
  supplierId?: string,
  brandId?: string
): Promise<CommissionWithDetails[]> {
  const filters: CommissionReportFilters = { status: "approved" };
  if (supplierId) filters.supplierId = supplierId;
  if (brandId) filters.brandId = brandId;
  return getCommissionsWithDetails(filters);
}

// ============================================================================
// PER-BRAND COMMISSION REPORT TYPES AND FUNCTIONS
// ============================================================================

export interface BrandFranchiseeCommission {
  franchiseeId: string;
  franchiseeName: string;
  franchiseeCode: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

export interface BrandSupplierCommission {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

export interface BrandCommissionPeriod {
  periodStartDate: string;
  periodEndDate: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
}

export interface PerBrandReportFilters {
  brandId: string;
  startDate?: string;
  endDate?: string;
  supplierId?: string;
  status?: string;
}

export interface PerBrandReportData {
  brand: {
    id: string;
    nameHe: string;
    nameEn: string | null;
    code: string;
    contactEmail: string | null;
    contactPhone: string | null;
  };
  summary: {
    totalFranchisees: number;
    totalSuppliers: number;
    totalCommissions: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCommissionAmount: number;
    avgCommissionRate: number;
    periodRange: {
      startDate: string | null;
      endDate: string | null;
    };
    generatedAt: string;
  };
  byFranchisee: BrandFranchiseeCommission[];
  bySupplier: BrandSupplierCommission[];
  byPeriod: BrandCommissionPeriod[];
  details: CommissionWithDetails[];
}

/**
 * Get commission details for a specific brand
 */
export async function getBrandCommissionsWithDetails(
  filters: PerBrandReportFilters
): Promise<CommissionWithDetails[]> {
  const conditions = [eq(franchisee.brandId, filters.brandId)];

  if (filters.startDate) {
    conditions.push(gte(commission.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(commission.periodEndDate, filters.endDate));
  }

  if (filters.supplierId) {
    conditions.push(eq(commission.supplierId, filters.supplierId));
  }

  if (filters.status) {
    conditions.push(eq(commission.status, filters.status as Commission["status"]));
  }

  const results = await database
    .select({
      // Commission fields
      id: commission.id,
      supplierId: commission.supplierId,
      franchiseeId: commission.franchiseeId,
      settlementPeriodId: commission.settlementPeriodId,
      periodStartDate: commission.periodStartDate,
      periodEndDate: commission.periodEndDate,
      status: commission.status,
      grossAmount: commission.grossAmount,
      netAmount: commission.netAmount,
      vatAdjusted: commission.vatAdjusted,
      commissionRate: commission.commissionRate,
      commissionAmount: commission.commissionAmount,
      invoiceNumber: commission.invoiceNumber,
      invoiceDate: commission.invoiceDate,
      notes: commission.notes,
      metadata: commission.metadata,
      calculatedAt: commission.calculatedAt,
      approvedAt: commission.approvedAt,
      approvedBy: commission.approvedBy,
      paidAt: commission.paidAt,
      createdAt: commission.createdAt,
      updatedAt: commission.updatedAt,
      createdBy: commission.createdBy,
      // Joined fields
      supplierName: supplier.name,
      supplierCode: supplier.code,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      brandId: franchisee.brandId,
      brandNameHe: brand.nameHe,
      brandNameEn: brand.nameEn,
    })
    .from(commission)
    .innerJoin(supplier, eq(commission.supplierId, supplier.id))
    .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
    .innerJoin(brand, eq(franchisee.brandId, brand.id))
    .where(and(...conditions))
    .orderBy(desc(commission.periodStartDate), asc(supplier.name), asc(franchisee.name));

  return results as CommissionWithDetails[];
}

/**
 * Get commission summary grouped by franchisee for a specific brand
 */
export async function getBrandCommissionsByFranchisee(
  filters: PerBrandReportFilters
): Promise<BrandFranchiseeCommission[]> {
  const conditions = [eq(franchisee.brandId, filters.brandId)];

  if (filters.startDate) {
    conditions.push(gte(commission.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(commission.periodEndDate, filters.endDate));
  }

  if (filters.supplierId) {
    conditions.push(eq(commission.supplierId, filters.supplierId));
  }

  if (filters.status) {
    conditions.push(eq(commission.status, filters.status as Commission["status"]));
  }

  const results = await database
    .select({
      franchiseeId: franchisee.id,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      commissionCount: sql<number>`count(${commission.id})::int`,
      totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
      totalNetAmount: sql<number>`coalesce(sum(${commission.netAmount}::numeric), 0)::numeric`,
      totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
      avgCommissionRate: sql<number>`coalesce(avg(${commission.commissionRate}::numeric), 0)::numeric`,
    })
    .from(commission)
    .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
    .where(and(...conditions))
    .groupBy(franchisee.id, franchisee.name, franchisee.code)
    .orderBy(desc(sql`sum(${commission.commissionAmount}::numeric)`));

  return results.map((r) => ({
    franchiseeId: r.franchiseeId,
    franchiseeName: r.franchiseeName,
    franchiseeCode: r.franchiseeCode,
    commissionCount: r.commissionCount,
    totalGrossAmount: Number(r.totalGrossAmount),
    totalNetAmount: Number(r.totalNetAmount),
    totalCommissionAmount: Number(r.totalCommissionAmount),
    avgCommissionRate: Number(r.avgCommissionRate),
  }));
}

/**
 * Get commission summary grouped by supplier for a specific brand
 */
export async function getBrandCommissionsBySupplier(
  filters: PerBrandReportFilters
): Promise<BrandSupplierCommission[]> {
  const conditions = [eq(franchisee.brandId, filters.brandId)];

  if (filters.startDate) {
    conditions.push(gte(commission.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(commission.periodEndDate, filters.endDate));
  }

  if (filters.supplierId) {
    conditions.push(eq(commission.supplierId, filters.supplierId));
  }

  if (filters.status) {
    conditions.push(eq(commission.status, filters.status as Commission["status"]));
  }

  const results = await database
    .select({
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      commissionCount: sql<number>`count(${commission.id})::int`,
      totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
      totalNetAmount: sql<number>`coalesce(sum(${commission.netAmount}::numeric), 0)::numeric`,
      totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
      avgCommissionRate: sql<number>`coalesce(avg(${commission.commissionRate}::numeric), 0)::numeric`,
    })
    .from(commission)
    .innerJoin(supplier, eq(commission.supplierId, supplier.id))
    .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
    .where(and(...conditions))
    .groupBy(supplier.id, supplier.name, supplier.code)
    .orderBy(desc(sql`sum(${commission.commissionAmount}::numeric)`));

  return results.map((r) => ({
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    supplierCode: r.supplierCode,
    commissionCount: r.commissionCount,
    totalGrossAmount: Number(r.totalGrossAmount),
    totalNetAmount: Number(r.totalNetAmount),
    totalCommissionAmount: Number(r.totalCommissionAmount),
    avgCommissionRate: Number(r.avgCommissionRate),
  }));
}

/**
 * Get commission summary grouped by period for a specific brand
 */
export async function getBrandCommissionsByPeriod(
  filters: PerBrandReportFilters
): Promise<BrandCommissionPeriod[]> {
  const conditions = [eq(franchisee.brandId, filters.brandId)];

  if (filters.startDate) {
    conditions.push(gte(commission.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(commission.periodEndDate, filters.endDate));
  }

  if (filters.supplierId) {
    conditions.push(eq(commission.supplierId, filters.supplierId));
  }

  if (filters.status) {
    conditions.push(eq(commission.status, filters.status as Commission["status"]));
  }

  const results = await database
    .select({
      periodStartDate: commission.periodStartDate,
      periodEndDate: commission.periodEndDate,
      commissionCount: sql<number>`count(${commission.id})::int`,
      totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
      totalNetAmount: sql<number>`coalesce(sum(${commission.netAmount}::numeric), 0)::numeric`,
      totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
    })
    .from(commission)
    .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
    .where(and(...conditions))
    .groupBy(commission.periodStartDate, commission.periodEndDate)
    .orderBy(desc(commission.periodStartDate));

  return results.map((r) => ({
    periodStartDate: r.periodStartDate,
    periodEndDate: r.periodEndDate,
    commissionCount: r.commissionCount,
    totalGrossAmount: Number(r.totalGrossAmount),
    totalNetAmount: Number(r.totalNetAmount),
    totalCommissionAmount: Number(r.totalCommissionAmount),
  }));
}

/**
 * Get complete per-brand commission report data
 * Includes summary, breakdown by franchisee, supplier, period, details
 * Ready for invoice generation
 */
export async function getPerBrandReportData(
  filters: PerBrandReportFilters
): Promise<PerBrandReportData | null> {
  // Fetch brand info
  const brandResult = await database
    .select({
      id: brand.id,
      nameHe: brand.nameHe,
      nameEn: brand.nameEn,
      code: brand.code,
      contactEmail: brand.contactEmail,
      contactPhone: brand.contactPhone,
    })
    .from(brand)
    .where(eq(brand.id, filters.brandId))
    .limit(1);

  if (brandResult.length === 0) {
    return null;
  }

  const brandInfo = brandResult[0];

  // Fetch all data in parallel
  const [details, byFranchisee, bySupplier, byPeriod] = await Promise.all([
    getBrandCommissionsWithDetails(filters),
    getBrandCommissionsByFranchisee(filters),
    getBrandCommissionsBySupplier(filters),
    getBrandCommissionsByPeriod(filters),
  ]);

  // Calculate overall summary from details
  const totalCommissions = details.length;
  const uniqueFranchisees = new Set(details.map((d) => d.franchiseeId)).size;
  const uniqueSuppliers = new Set(details.map((d) => d.supplierId)).size;
  const totalGrossAmount = details.reduce(
    (sum, c) => sum + Number(c.grossAmount || 0),
    0
  );
  const totalNetAmount = details.reduce(
    (sum, c) => sum + Number(c.netAmount || 0),
    0
  );
  const totalCommissionAmount = details.reduce(
    (sum, c) => sum + Number(c.commissionAmount || 0),
    0
  );
  const avgCommissionRate =
    totalCommissions > 0
      ? details.reduce((sum, c) => sum + Number(c.commissionRate || 0), 0) /
        totalCommissions
      : 0;

  // Get period range
  const periodDates = details.map((c) => ({
    start: c.periodStartDate,
    end: c.periodEndDate,
  }));
  const startDate =
    periodDates.length > 0
      ? periodDates.reduce(
          (min, d) => (d.start < min ? d.start : min),
          periodDates[0].start
        )
      : null;
  const endDate =
    periodDates.length > 0
      ? periodDates.reduce(
          (max, d) => (d.end > max ? d.end : max),
          periodDates[0].end
        )
      : null;

  return {
    brand: brandInfo,
    summary: {
      totalFranchisees: uniqueFranchisees,
      totalSuppliers: uniqueSuppliers,
      totalCommissions,
      totalGrossAmount,
      totalNetAmount,
      totalCommissionAmount,
      avgCommissionRate,
      periodRange: {
        startDate,
        endDate,
      },
      generatedAt: new Date().toISOString(),
    },
    byFranchisee,
    bySupplier,
    byPeriod,
    details,
  };
}

/**
 * Get all suppliers for filter dropdown
 */
export async function getAllSuppliers(): Promise<{ id: string; name: string; code: string }[]> {
  const results = await database
    .select({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
    })
    .from(supplier)
    .where(eq(supplier.isActive, true))
    .orderBy(asc(supplier.name));

  return results;
}

// ============================================================================
// PER-FRANCHISEE PURCHASE REPORT TYPES AND FUNCTIONS
// ============================================================================

export interface FranchiseeSupplierPurchase {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  purchaseCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

export interface FranchiseePurchasePeriod {
  periodStartDate: string;
  periodEndDate: string;
  purchaseCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
}

export interface PerFranchiseeReportFilters {
  franchiseeId: string;
  startDate?: string;
  endDate?: string;
  supplierId?: string;
  status?: string;
}

export interface PerFranchiseeReportData {
  franchisee: {
    id: string;
    name: string;
    code: string;
    brandId: string;
    brandNameHe: string;
    brandNameEn: string | null;
    primaryContactName: string | null;
    primaryContactEmail: string | null;
    primaryContactPhone: string | null;
  };
  summary: {
    totalSuppliers: number;
    totalPurchases: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCommissionAmount: number;
    avgCommissionRate: number;
    periodRange: {
      startDate: string | null;
      endDate: string | null;
    };
    generatedAt: string;
  };
  bySupplier: FranchiseeSupplierPurchase[];
  byPeriod: FranchiseePurchasePeriod[];
  details: CommissionWithDetails[];
}

/**
 * Get commission details for a specific franchisee (purchase report)
 */
export async function getFranchiseeCommissionsWithDetails(
  filters: PerFranchiseeReportFilters
): Promise<CommissionWithDetails[]> {
  const conditions = [eq(commission.franchiseeId, filters.franchiseeId)];

  if (filters.startDate) {
    conditions.push(gte(commission.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(commission.periodEndDate, filters.endDate));
  }

  if (filters.supplierId) {
    conditions.push(eq(commission.supplierId, filters.supplierId));
  }

  if (filters.status) {
    conditions.push(eq(commission.status, filters.status as Commission["status"]));
  }

  const results = await database
    .select({
      // Commission fields
      id: commission.id,
      supplierId: commission.supplierId,
      franchiseeId: commission.franchiseeId,
      settlementPeriodId: commission.settlementPeriodId,
      periodStartDate: commission.periodStartDate,
      periodEndDate: commission.periodEndDate,
      status: commission.status,
      grossAmount: commission.grossAmount,
      netAmount: commission.netAmount,
      vatAdjusted: commission.vatAdjusted,
      commissionRate: commission.commissionRate,
      commissionAmount: commission.commissionAmount,
      invoiceNumber: commission.invoiceNumber,
      invoiceDate: commission.invoiceDate,
      notes: commission.notes,
      metadata: commission.metadata,
      calculatedAt: commission.calculatedAt,
      approvedAt: commission.approvedAt,
      approvedBy: commission.approvedBy,
      paidAt: commission.paidAt,
      createdAt: commission.createdAt,
      updatedAt: commission.updatedAt,
      createdBy: commission.createdBy,
      // Joined fields
      supplierName: supplier.name,
      supplierCode: supplier.code,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      brandId: franchisee.brandId,
      brandNameHe: brand.nameHe,
      brandNameEn: brand.nameEn,
    })
    .from(commission)
    .innerJoin(supplier, eq(commission.supplierId, supplier.id))
    .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
    .innerJoin(brand, eq(franchisee.brandId, brand.id))
    .where(and(...conditions))
    .orderBy(desc(commission.periodStartDate), asc(supplier.name));

  return results as CommissionWithDetails[];
}

/**
 * Get commission summary grouped by supplier for a specific franchisee
 */
export async function getFranchiseeCommissionsBySupplier(
  filters: PerFranchiseeReportFilters
): Promise<FranchiseeSupplierPurchase[]> {
  const conditions = [eq(commission.franchiseeId, filters.franchiseeId)];

  if (filters.startDate) {
    conditions.push(gte(commission.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(commission.periodEndDate, filters.endDate));
  }

  if (filters.supplierId) {
    conditions.push(eq(commission.supplierId, filters.supplierId));
  }

  if (filters.status) {
    conditions.push(eq(commission.status, filters.status as Commission["status"]));
  }

  const results = await database
    .select({
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      purchaseCount: sql<number>`count(${commission.id})::int`,
      totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
      totalNetAmount: sql<number>`coalesce(sum(${commission.netAmount}::numeric), 0)::numeric`,
      totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
      avgCommissionRate: sql<number>`coalesce(avg(${commission.commissionRate}::numeric), 0)::numeric`,
    })
    .from(commission)
    .innerJoin(supplier, eq(commission.supplierId, supplier.id))
    .where(and(...conditions))
    .groupBy(supplier.id, supplier.name, supplier.code)
    .orderBy(desc(sql`sum(${commission.grossAmount}::numeric)`));

  return results.map((r) => ({
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    supplierCode: r.supplierCode,
    purchaseCount: r.purchaseCount,
    totalGrossAmount: Number(r.totalGrossAmount),
    totalNetAmount: Number(r.totalNetAmount),
    totalCommissionAmount: Number(r.totalCommissionAmount),
    avgCommissionRate: Number(r.avgCommissionRate),
  }));
}

/**
 * Get commission summary grouped by period for a specific franchisee
 */
export async function getFranchiseeCommissionsByPeriod(
  filters: PerFranchiseeReportFilters
): Promise<FranchiseePurchasePeriod[]> {
  const conditions = [eq(commission.franchiseeId, filters.franchiseeId)];

  if (filters.startDate) {
    conditions.push(gte(commission.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(commission.periodEndDate, filters.endDate));
  }

  if (filters.supplierId) {
    conditions.push(eq(commission.supplierId, filters.supplierId));
  }

  if (filters.status) {
    conditions.push(eq(commission.status, filters.status as Commission["status"]));
  }

  const results = await database
    .select({
      periodStartDate: commission.periodStartDate,
      periodEndDate: commission.periodEndDate,
      purchaseCount: sql<number>`count(${commission.id})::int`,
      totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
      totalNetAmount: sql<number>`coalesce(sum(${commission.netAmount}::numeric), 0)::numeric`,
      totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
    })
    .from(commission)
    .where(and(...conditions))
    .groupBy(commission.periodStartDate, commission.periodEndDate)
    .orderBy(desc(commission.periodStartDate));

  return results.map((r) => ({
    periodStartDate: r.periodStartDate,
    periodEndDate: r.periodEndDate,
    purchaseCount: r.purchaseCount,
    totalGrossAmount: Number(r.totalGrossAmount),
    totalNetAmount: Number(r.totalNetAmount),
    totalCommissionAmount: Number(r.totalCommissionAmount),
  }));
}

/**
 * Get complete per-franchisee purchase report data
 * Shows all suppliers the franchisee purchased from, amounts, and details
 */
export async function getPerFranchiseeReportData(
  filters: PerFranchiseeReportFilters
): Promise<PerFranchiseeReportData | null> {
  // Fetch franchisee info with brand
  const franchiseeResult = await database
    .select({
      id: franchisee.id,
      name: franchisee.name,
      code: franchisee.code,
      brandId: franchisee.brandId,
      brandNameHe: brand.nameHe,
      brandNameEn: brand.nameEn,
      primaryContactName: franchisee.primaryContactName,
      primaryContactEmail: franchisee.primaryContactEmail,
      primaryContactPhone: franchisee.primaryContactPhone,
    })
    .from(franchisee)
    .innerJoin(brand, eq(franchisee.brandId, brand.id))
    .where(eq(franchisee.id, filters.franchiseeId))
    .limit(1);

  if (franchiseeResult.length === 0) {
    return null;
  }

  const franchiseeInfo = franchiseeResult[0];

  // Fetch all data in parallel
  const [details, bySupplier, byPeriod] = await Promise.all([
    getFranchiseeCommissionsWithDetails(filters),
    getFranchiseeCommissionsBySupplier(filters),
    getFranchiseeCommissionsByPeriod(filters),
  ]);

  // Calculate overall summary from details
  const totalPurchases = details.length;
  const uniqueSuppliers = new Set(details.map((d) => d.supplierId)).size;
  const totalGrossAmount = details.reduce(
    (sum, c) => sum + Number(c.grossAmount || 0),
    0
  );
  const totalNetAmount = details.reduce(
    (sum, c) => sum + Number(c.netAmount || 0),
    0
  );
  const totalCommissionAmount = details.reduce(
    (sum, c) => sum + Number(c.commissionAmount || 0),
    0
  );
  const avgCommissionRate =
    totalPurchases > 0
      ? details.reduce((sum, c) => sum + Number(c.commissionRate || 0), 0) /
        totalPurchases
      : 0;

  // Get period range
  const periodDates = details.map((c) => ({
    start: c.periodStartDate,
    end: c.periodEndDate,
  }));
  const startDate =
    periodDates.length > 0
      ? periodDates.reduce(
          (min, d) => (d.start < min ? d.start : min),
          periodDates[0].start
        )
      : null;
  const endDate =
    periodDates.length > 0
      ? periodDates.reduce(
          (max, d) => (d.end > max ? d.end : max),
          periodDates[0].end
        )
      : null;

  return {
    franchisee: franchiseeInfo,
    summary: {
      totalSuppliers: uniqueSuppliers,
      totalPurchases,
      totalGrossAmount,
      totalNetAmount,
      totalCommissionAmount,
      avgCommissionRate,
      periodRange: {
        startDate,
        endDate,
      },
      generatedAt: new Date().toISOString(),
    },
    bySupplier,
    byPeriod,
    details,
  };
}

/**
 * Get all franchisees for filter dropdown
 */
export async function getAllFranchisees(): Promise<{ id: string; name: string; code: string; brandNameHe: string }[]> {
  const results = await database
    .select({
      id: franchisee.id,
      name: franchisee.name,
      code: franchisee.code,
      brandNameHe: brand.nameHe,
    })
    .from(franchisee)
    .innerJoin(brand, eq(franchisee.brandId, brand.id))
    .where(eq(franchisee.isActive, true))
    .orderBy(asc(franchisee.name));

  return results;
}

// ============================================================================
// SUPPLIER VARIANCE DETECTION REPORT
// ============================================================================

export interface SupplierPurchasePercentage {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  totalGrossAmount: number;
  purchasePercentage: number;
}

export interface SupplierVarianceData {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  currentPeriod: {
    totalGrossAmount: number;
    purchasePercentage: number;
  };
  previousPeriod: {
    totalGrossAmount: number;
    purchasePercentage: number;
  };
  variance: number; // Absolute difference in percentage points
  variancePercent: number; // Relative change percentage
  isFlagged: boolean; // True if variance > 10%
}

export interface VarianceReportFilters {
  currentStartDate: string;
  currentEndDate: string;
  previousStartDate: string;
  previousEndDate: string;
  brandId?: string;
  varianceThreshold?: number; // Default 10%
}

export interface VarianceReportData {
  summary: {
    totalSuppliers: number;
    flaggedSuppliers: number;
    totalCurrentGross: number;
    totalPreviousGross: number;
    currentPeriod: {
      startDate: string;
      endDate: string;
    };
    previousPeriod: {
      startDate: string;
      endDate: string;
    };
    varianceThreshold: number;
    generatedAt: string;
  };
  suppliers: SupplierVarianceData[];
  flaggedOnly: SupplierVarianceData[];
}

/**
 * Get supplier purchase percentages for a specific period
 */
export async function getSupplierPurchasePercentages(
  startDate: string,
  endDate: string,
  brandId?: string
): Promise<SupplierPurchasePercentage[]> {
  const conditions = [
    gte(commission.periodStartDate, startDate),
    lte(commission.periodEndDate, endDate),
  ];

  if (brandId) {
    conditions.push(eq(franchisee.brandId, brandId));
  }

  // Get totals grouped by supplier
  const results = brandId
    ? await database
        .select({
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierCode: supplier.code,
          totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
        })
        .from(commission)
        .innerJoin(supplier, eq(commission.supplierId, supplier.id))
        .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
        .where(and(...conditions))
        .groupBy(supplier.id, supplier.name, supplier.code)
        .orderBy(desc(sql`sum(${commission.grossAmount}::numeric)`))
    : await database
        .select({
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierCode: supplier.code,
          totalGrossAmount: sql<number>`coalesce(sum(${commission.grossAmount}::numeric), 0)::numeric`,
        })
        .from(commission)
        .innerJoin(supplier, eq(commission.supplierId, supplier.id))
        .where(and(...conditions))
        .groupBy(supplier.id, supplier.name, supplier.code)
        .orderBy(desc(sql`sum(${commission.grossAmount}::numeric)`));

  // Calculate total gross for all suppliers
  const totalGross = results.reduce(
    (sum, r) => sum + Number(r.totalGrossAmount),
    0
  );

  // Calculate purchase percentage for each supplier
  return results.map((r) => ({
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    supplierCode: r.supplierCode,
    totalGrossAmount: Number(r.totalGrossAmount),
    purchasePercentage: totalGross > 0
      ? roundToTwoDecimals((Number(r.totalGrossAmount) / totalGross) * 100)
      : 0,
  }));
}

/**
 * Get variance report comparing current period to previous period
 * Flags suppliers with >10% variance in purchase percentage
 */
export async function getVarianceReportData(
  filters: VarianceReportFilters
): Promise<VarianceReportData> {
  const varianceThreshold = filters.varianceThreshold ?? 10;

  // Get purchase percentages for both periods in parallel
  const [currentPeriodData, previousPeriodData] = await Promise.all([
    getSupplierPurchasePercentages(
      filters.currentStartDate,
      filters.currentEndDate,
      filters.brandId
    ),
    getSupplierPurchasePercentages(
      filters.previousStartDate,
      filters.previousEndDate,
      filters.brandId
    ),
  ]);

  // Create maps for easy lookup
  const currentMap = new Map(
    currentPeriodData.map((s) => [s.supplierId, s])
  );
  const previousMap = new Map(
    previousPeriodData.map((s) => [s.supplierId, s])
  );

  // Get all unique supplier IDs
  const allSupplierIds = new Set([
    ...currentPeriodData.map((s) => s.supplierId),
    ...previousPeriodData.map((s) => s.supplierId),
  ]);

  // Calculate totals
  const totalCurrentGross = currentPeriodData.reduce(
    (sum, s) => sum + s.totalGrossAmount,
    0
  );
  const totalPreviousGross = previousPeriodData.reduce(
    (sum, s) => sum + s.totalGrossAmount,
    0
  );

  // Build variance data for each supplier
  const suppliers: SupplierVarianceData[] = [];

  for (const supplierId of allSupplierIds) {
    const current = currentMap.get(supplierId);
    const previous = previousMap.get(supplierId);

    // Get supplier info from whichever period has it
    const supplierInfo = current || previous;
    if (!supplierInfo) continue;

    const currentPurchasePercent = current?.purchasePercentage ?? 0;
    const previousPurchasePercent = previous?.purchasePercentage ?? 0;

    // Calculate variance (absolute difference in percentage points)
    const variance = roundToTwoDecimals(
      Math.abs(currentPurchasePercent - previousPurchasePercent)
    );

    // Calculate relative variance percentage
    const variancePercent = previousPurchasePercent > 0
      ? roundToTwoDecimals(
          ((currentPurchasePercent - previousPurchasePercent) /
            previousPurchasePercent) *
            100
        )
      : currentPurchasePercent > 0
      ? 100 // New supplier = 100% increase
      : 0;

    // Flag if variance exceeds threshold
    const isFlagged = variance > varianceThreshold;

    suppliers.push({
      supplierId,
      supplierName: supplierInfo.supplierName,
      supplierCode: supplierInfo.supplierCode,
      currentPeriod: {
        totalGrossAmount: current?.totalGrossAmount ?? 0,
        purchasePercentage: currentPurchasePercent,
      },
      previousPeriod: {
        totalGrossAmount: previous?.totalGrossAmount ?? 0,
        purchasePercentage: previousPurchasePercent,
      },
      variance,
      variancePercent,
      isFlagged,
    });
  }

  // Sort by variance (highest first)
  suppliers.sort((a, b) => b.variance - a.variance);

  // Get flagged suppliers
  const flaggedOnly = suppliers.filter((s) => s.isFlagged);

  return {
    summary: {
      totalSuppliers: suppliers.length,
      flaggedSuppliers: flaggedOnly.length,
      totalCurrentGross: roundToTwoDecimals(totalCurrentGross),
      totalPreviousGross: roundToTwoDecimals(totalPreviousGross),
      currentPeriod: {
        startDate: filters.currentStartDate,
        endDate: filters.currentEndDate,
      },
      previousPeriod: {
        startDate: filters.previousStartDate,
        endDate: filters.previousEndDate,
      },
      varianceThreshold,
      generatedAt: new Date().toISOString(),
    },
    suppliers,
    flaggedOnly,
  };
}
