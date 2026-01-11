import { database } from "@/db";
import {
  commission,
  supplier,
  franchisee,
  brand,
  settlementPeriod,
  type Commission,
  type Brand,
  type Supplier,
  type Franchisee,
} from "@/db/schema";
import { eq, and, gte, lte, desc, sql, asc, count, sum, avg } from "drizzle-orm";

// ============================================================================
// REPORT TYPES
// ============================================================================

export type ReportType =
  | "commissions"
  | "settlements"
  | "franchisees"
  | "suppliers";

export interface ReportFilters {
  reportType: ReportType;
  startDate?: string;
  endDate?: string;
  brandId?: string;
  supplierId?: string;
  franchiseeId?: string;
  status?: string;
}

// ============================================================================
// COMMISSION REPORT TYPES
// ============================================================================

export interface CommissionReportRow {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  franchiseeId: string;
  franchiseeName: string;
  franchiseeCode: string;
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  periodStartDate: string;
  periodEndDate: string;
  status: string;
  grossAmount: string;
  netAmount: string | null;
  commissionRate: string;
  commissionAmount: string;
}

export interface CommissionReportSummary {
  totalRecords: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

// ============================================================================
// SETTLEMENT REPORT TYPES
// ============================================================================

export interface SettlementReportRow {
  id: string;
  name: string;
  franchiseeId: string;
  franchiseeName: string;
  franchiseeCode: string;
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  periodType: string;
  periodStartDate: string;
  periodEndDate: string;
  status: string;
  grossSales: string | null;
  netSales: string | null;
  royaltyAmount: string | null;
  marketingFeeAmount: string | null;
  totalDeductions: string | null;
  netPayable: string | null;
}

export interface SettlementReportSummary {
  totalRecords: number;
  totalGrossSales: number;
  totalNetSales: number;
  totalRoyaltyAmount: number;
  totalNetPayable: number;
}

// ============================================================================
// FRANCHISEE REPORT TYPES
// ============================================================================

export interface FranchiseeReportRow {
  id: string;
  name: string;
  code: string;
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  status: string;
  city: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  openingDate: string | null;
  isActive: boolean;
}

export interface FranchiseeReportSummary {
  totalRecords: number;
  activeCount: number;
  inactiveCount: number;
  pendingCount: number;
  byBrand: { brandId: string; brandNameHe: string; count: number }[];
}

// ============================================================================
// SUPPLIER REPORT TYPES
// ============================================================================

export interface SupplierReportRow {
  id: string;
  name: string;
  code: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  defaultCommissionRate: string | null;
  commissionType: string | null;
  settlementFrequency: string | null;
  isActive: boolean;
  totalCommissions: number;
  totalCommissionAmount: number;
}

export interface SupplierReportSummary {
  totalRecords: number;
  activeCount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

// ============================================================================
// UNIFIED REPORT DATA
// ============================================================================

export interface ReportData<T, S> {
  rows: T[];
  summary: S;
  filters: {
    brands: { id: string; nameHe: string; nameEn: string | null }[];
    suppliers: { id: string; name: string; code: string }[];
    franchisees: { id: string; name: string; code: string }[];
  };
  generatedAt: string;
}

export type CommissionReportData = ReportData<CommissionReportRow, CommissionReportSummary>;
export type SettlementReportData = ReportData<SettlementReportRow, SettlementReportSummary>;
export type FranchiseeReportData = ReportData<FranchiseeReportRow, FranchiseeReportSummary>;
export type SupplierReportData = ReportData<SupplierReportRow, SupplierReportSummary>;

// ============================================================================
// DATA ACCESS FUNCTIONS
// ============================================================================

/**
 * Get all active brands for filter dropdown
 */
export async function getAllBrands(): Promise<Brand[]> {
  const results = await database
    .select()
    .from(brand)
    .where(eq(brand.isActive, true))
    .orderBy(asc(brand.nameHe));
  return results;
}

/**
 * Get all active and visible suppliers for filter dropdown
 * Hidden suppliers are excluded from commission reports
 */
export async function getActiveSuppliers(): Promise<Supplier[]> {
  const results = await database
    .select()
    .from(supplier)
    .where(and(eq(supplier.isActive, true), eq(supplier.isHidden, false)))
    .orderBy(asc(supplier.name));
  return results;
}

/**
 * Get all franchisees for filter dropdown
 */
export async function getAllFranchisees(): Promise<Franchisee[]> {
  const results = await database
    .select()
    .from(franchisee)
    .orderBy(asc(franchisee.name));
  return results;
}

/**
 * Get commission report data
 * Excludes hidden suppliers from the report
 */
export async function getCommissionReportData(
  filters: ReportFilters
): Promise<CommissionReportData> {
  const conditions = [];

  // Always exclude hidden suppliers from commission reports
  conditions.push(eq(supplier.isHidden, false));

  if (filters.startDate) {
    conditions.push(gte(commission.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(commission.periodEndDate, filters.endDate));
  }

  if (filters.supplierId) {
    conditions.push(eq(commission.supplierId, filters.supplierId));
  }

  if (filters.franchiseeId) {
    conditions.push(eq(commission.franchiseeId, filters.franchiseeId));
  }

  if (filters.status) {
    conditions.push(eq(commission.status, filters.status as Commission["status"]));
  }

  // Join with brand to filter by brandId
  const baseQuery = database
    .select({
      id: commission.id,
      supplierId: commission.supplierId,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      franchiseeId: commission.franchiseeId,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      brandId: franchisee.brandId,
      brandNameHe: brand.nameHe,
      brandNameEn: brand.nameEn,
      periodStartDate: commission.periodStartDate,
      periodEndDate: commission.periodEndDate,
      status: commission.status,
      grossAmount: commission.grossAmount,
      netAmount: commission.netAmount,
      commissionRate: commission.commissionRate,
      commissionAmount: commission.commissionAmount,
    })
    .from(commission)
    .innerJoin(supplier, eq(commission.supplierId, supplier.id))
    .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
    .innerJoin(brand, eq(franchisee.brandId, brand.id));

  let whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  if (filters.brandId) {
    whereClause = whereClause
      ? and(whereClause, eq(franchisee.brandId, filters.brandId))
      : eq(franchisee.brandId, filters.brandId);
  }

  const rows = await baseQuery
    .where(whereClause)
    .orderBy(desc(commission.periodStartDate));

  // Calculate summary
  const totalRecords = rows.length;
  const totalGrossAmount = rows.reduce((sum, r) => sum + Number(r.grossAmount || 0), 0);
  const totalNetAmount = rows.reduce((sum, r) => sum + Number(r.netAmount || 0), 0);
  const totalCommissionAmount = rows.reduce((sum, r) => sum + Number(r.commissionAmount || 0), 0);
  const avgCommissionRate = totalRecords > 0
    ? rows.reduce((sum, r) => sum + Number(r.commissionRate || 0), 0) / totalRecords
    : 0;

  // Get filter options
  const [brands, suppliers, franchisees] = await Promise.all([
    getAllBrands(),
    getActiveSuppliers(),
    getAllFranchisees(),
  ]);

  return {
    rows: rows as CommissionReportRow[],
    summary: {
      totalRecords,
      totalGrossAmount,
      totalNetAmount,
      totalCommissionAmount,
      avgCommissionRate,
    },
    filters: {
      brands: brands.map((b) => ({ id: b.id, nameHe: b.nameHe, nameEn: b.nameEn })),
      suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, code: s.code })),
      franchisees: franchisees.map((f) => ({ id: f.id, name: f.name, code: f.code })),
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get settlement report data
 */
export async function getSettlementReportData(
  filters: ReportFilters
): Promise<SettlementReportData> {
  const conditions = [];

  if (filters.startDate) {
    conditions.push(gte(settlementPeriod.periodStartDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(settlementPeriod.periodEndDate, filters.endDate));
  }

  if (filters.franchiseeId) {
    conditions.push(eq(settlementPeriod.franchiseeId, filters.franchiseeId));
  }

  if (filters.status) {
    conditions.push(eq(settlementPeriod.status, filters.status as any));
  }

  const baseQuery = database
    .select({
      id: settlementPeriod.id,
      name: settlementPeriod.name,
      franchiseeId: settlementPeriod.franchiseeId,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      brandId: franchisee.brandId,
      brandNameHe: brand.nameHe,
      brandNameEn: brand.nameEn,
      periodType: settlementPeriod.periodType,
      periodStartDate: settlementPeriod.periodStartDate,
      periodEndDate: settlementPeriod.periodEndDate,
      status: settlementPeriod.status,
      grossSales: settlementPeriod.grossSales,
      netSales: settlementPeriod.netSales,
      royaltyAmount: settlementPeriod.royaltyAmount,
      marketingFeeAmount: settlementPeriod.marketingFeeAmount,
      totalDeductions: settlementPeriod.totalDeductions,
      netPayable: settlementPeriod.netPayable,
    })
    .from(settlementPeriod)
    .innerJoin(franchisee, eq(settlementPeriod.franchiseeId, franchisee.id))
    .innerJoin(brand, eq(franchisee.brandId, brand.id));

  let whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  if (filters.brandId) {
    whereClause = whereClause
      ? and(whereClause, eq(franchisee.brandId, filters.brandId))
      : eq(franchisee.brandId, filters.brandId);
  }

  const rows = await baseQuery
    .where(whereClause)
    .orderBy(desc(settlementPeriod.periodStartDate));

  // Calculate summary
  const totalRecords = rows.length;
  const totalGrossSales = rows.reduce((sum, r) => sum + Number(r.grossSales || 0), 0);
  const totalNetSales = rows.reduce((sum, r) => sum + Number(r.netSales || 0), 0);
  const totalRoyaltyAmount = rows.reduce((sum, r) => sum + Number(r.royaltyAmount || 0), 0);
  const totalNetPayable = rows.reduce((sum, r) => sum + Number(r.netPayable || 0), 0);

  // Get filter options
  const [brands, suppliers, franchisees] = await Promise.all([
    getAllBrands(),
    getActiveSuppliers(),
    getAllFranchisees(),
  ]);

  return {
    rows: rows as SettlementReportRow[],
    summary: {
      totalRecords,
      totalGrossSales,
      totalNetSales,
      totalRoyaltyAmount,
      totalNetPayable,
    },
    filters: {
      brands: brands.map((b) => ({ id: b.id, nameHe: b.nameHe, nameEn: b.nameEn })),
      suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, code: s.code })),
      franchisees: franchisees.map((f) => ({ id: f.id, name: f.name, code: f.code })),
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get franchisee report data
 */
export async function getFranchiseeReportData(
  filters: ReportFilters
): Promise<FranchiseeReportData> {
  const conditions = [];

  if (filters.brandId) {
    conditions.push(eq(franchisee.brandId, filters.brandId));
  }

  if (filters.status) {
    conditions.push(eq(franchisee.status, filters.status as Franchisee["status"]));
  }

  const rows = await database
    .select({
      id: franchisee.id,
      name: franchisee.name,
      code: franchisee.code,
      brandId: franchisee.brandId,
      brandNameHe: brand.nameHe,
      brandNameEn: brand.nameEn,
      status: franchisee.status,
      city: franchisee.city,
      contactEmail: franchisee.contactEmail,
      contactPhone: franchisee.contactPhone,
      openingDate: franchisee.openingDate,
      isActive: franchisee.isActive,
    })
    .from(franchisee)
    .innerJoin(brand, eq(franchisee.brandId, brand.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(franchisee.name));

  // Calculate summary
  const totalRecords = rows.length;
  const activeCount = rows.filter((r) => r.status === "active").length;
  const inactiveCount = rows.filter((r) => r.status === "inactive").length;
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  // Group by brand
  const brandCounts: Record<string, { brandId: string; brandNameHe: string; count: number }> = {};
  for (const row of rows) {
    if (!brandCounts[row.brandId]) {
      brandCounts[row.brandId] = { brandId: row.brandId, brandNameHe: row.brandNameHe, count: 0 };
    }
    brandCounts[row.brandId].count++;
  }

  // Get filter options
  const [brands, suppliers, franchisees] = await Promise.all([
    getAllBrands(),
    getActiveSuppliers(),
    getAllFranchisees(),
  ]);

  return {
    rows: rows as FranchiseeReportRow[],
    summary: {
      totalRecords,
      activeCount,
      inactiveCount,
      pendingCount,
      byBrand: Object.values(brandCounts),
    },
    filters: {
      brands: brands.map((b) => ({ id: b.id, nameHe: b.nameHe, nameEn: b.nameEn })),
      suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, code: s.code })),
      franchisees: franchisees.map((f) => ({ id: f.id, name: f.name, code: f.code })),
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get supplier report data with commission totals
 * Excludes hidden suppliers from the report
 */
export async function getSupplierReportData(
  filters: ReportFilters
): Promise<SupplierReportData> {
  const conditions = [];

  // Always exclude hidden suppliers from supplier reports
  conditions.push(eq(supplier.isHidden, false));

  if (filters.status === "active") {
    conditions.push(eq(supplier.isActive, true));
  } else if (filters.status === "inactive") {
    conditions.push(eq(supplier.isActive, false));
  }

  // Get all suppliers with commission aggregation
  const suppliersBase = await database
    .select()
    .from(supplier)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(supplier.name));

  // Get commission totals per supplier
  const commissionTotals = await database
    .select({
      supplierId: commission.supplierId,
      totalCommissions: sql<number>`count(*)::int`,
      totalCommissionAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
    })
    .from(commission)
    .groupBy(commission.supplierId);

  // Create a map of commission totals by supplier ID
  const commissionMap = new Map(commissionTotals.map((c) => [c.supplierId, c]));

  const rows: SupplierReportRow[] = suppliersBase.map((s) => {
    const commissionData = commissionMap.get(s.id);
    return {
      id: s.id,
      name: s.name,
      code: s.code,
      contactName: s.contactName,
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone,
      defaultCommissionRate: s.defaultCommissionRate,
      commissionType: s.commissionType,
      settlementFrequency: s.settlementFrequency,
      isActive: s.isActive,
      totalCommissions: commissionData?.totalCommissions || 0,
      totalCommissionAmount: Number(commissionData?.totalCommissionAmount || 0),
    };
  });

  // Calculate summary
  const totalRecords = rows.length;
  const activeCount = rows.filter((r) => r.isActive).length;
  const totalCommissionAmount = rows.reduce((sum, r) => sum + r.totalCommissionAmount, 0);
  const avgCommissionRate = totalRecords > 0
    ? rows.reduce((sum, r) => sum + Number(r.defaultCommissionRate || 0), 0) / totalRecords
    : 0;

  // Get filter options
  const [brands, suppliers, franchisees] = await Promise.all([
    getAllBrands(),
    getActiveSuppliers(),
    getAllFranchisees(),
  ]);

  return {
    rows,
    summary: {
      totalRecords,
      activeCount,
      totalCommissionAmount,
      avgCommissionRate,
    },
    filters: {
      brands: brands.map((b) => ({ id: b.id, nameHe: b.nameHe, nameEn: b.nameEn })),
      suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, code: s.code })),
      franchisees: franchisees.map((f) => ({ id: f.id, name: f.name, code: f.code })),
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get report data based on report type
 */
export async function getReportData(
  filters: ReportFilters
): Promise<CommissionReportData | SettlementReportData | FranchiseeReportData | SupplierReportData> {
  switch (filters.reportType) {
    case "commissions":
      return getCommissionReportData(filters);
    case "settlements":
      return getSettlementReportData(filters);
    case "franchisees":
      return getFranchiseeReportData(filters);
    case "suppliers":
      return getSupplierReportData(filters);
    default:
      return getCommissionReportData(filters);
  }
}
