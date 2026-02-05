import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getAllSupplierFileUploadsForYear } from "@/data-access/supplier-file-uploads";
import { getSuppliersWithBrands, type SupplierWithBrands } from "@/data-access/suppliers";
import { getPeriodsForYear, type SettlementPeriodInfo } from "@/lib/settlement-periods";
import { formatDateAsLocal } from "@/lib/date-utils";
import type { SettlementPeriodType } from "@/db/schema";
import { requiresCustomParser } from "@/lib/custom-parsers";

// File upload processing status type
type SupplierFileProcessingStatus =
  | "pending"
  | "processing"
  | "auto_approved"
  | "needs_review"
  | "approved"
  | "rejected";

/**
 * Period status for a supplier
 */
export interface PeriodStatus {
  key: string;
  name: string;
  nameHe: string;
  startDate: string;
  endDate: string;
  status: "approved" | "pending" | "missing";
  fileId?: string;
  fileName?: string;
  fileStatus?: SupplierFileProcessingStatus;
}

/**
 * Supplier completeness info
 * Note: frequency can include weekly/bi_weekly from supplier settings,
 * but these are filtered out as they're not supported for file uploads
 */
export interface SupplierCompleteness {
  supplier: {
    id: string;
    name: string;
    code: string;
  };
  frequency: string; // Using string to avoid type conflicts with unsupported frequencies
  brands: { id: string; nameHe: string }[];
  periods: PeriodStatus[];
  stats: {
    total: number;
    approved: number;
    pending: number;
    missing: number;
  };
}

/**
 * Supplier without parser configuration
 */
export interface SupplierWithoutParser {
  id: string;
  name: string;
  code: string;
  brands: { id: string; nameHe: string }[];
}

/**
 * API Response type
 */
export interface SupplierCompletenessResponse {
  year: number;
  suppliers: SupplierCompleteness[];
  suppliersWithoutParser: SupplierWithoutParser[];
  summary: {
    totalSuppliers: number;
    totalExpectedFiles: number;
    received: number;
    approved: number;
    pending: number;
    missing: number;
    completionPercentage: number;
  };
}

/**
 * GET /api/dashboard/supplier-completeness
 * Query params:
 *   - year: number (default: current year)
 *   - brandId: string (optional, filter by brand)
 *   - frequency: SettlementPeriodType (optional, filter by settlement frequency)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));
    const brandId = searchParams.get("brandId") || undefined;
    const frequencyFilter = searchParams.get("frequency") as SettlementPeriodType | undefined;

    // Get all active suppliers with brands
    const allSuppliers = await getSuppliersWithBrands(true);

    // Helper to check if supplier has a parser (either fileMapping or custom parser)
    const hasParser = (s: SupplierWithBrands) =>
      s.fileMapping !== null || (s.code && requiresCustomParser(s.code));

    // Filter suppliers - include those with fileMapping OR custom parser
    let filteredSuppliers = allSuppliers.filter(hasParser);

    if (brandId) {
      filteredSuppliers = filteredSuppliers.filter(s =>
        s.brands.some(b => b.id === brandId)
      );
    }

    if (frequencyFilter) {
      filteredSuppliers = filteredSuppliers.filter(s =>
        s.settlementFrequency === frequencyFilter
      );
    }

    // Get all file uploads for the year
    const allFiles = await getAllSupplierFileUploadsForYear(year);

    // Build a map of supplier -> period -> file
    const fileMap = new Map<string, Map<string, { id: string; fileName: string; status: SupplierFileProcessingStatus }>>();

    for (const file of allFiles) {
      if (!file.periodStartDate || !file.periodEndDate) continue;

      const supplierId = file.supplierId;
      if (!fileMap.has(supplierId)) {
        fileMap.set(supplierId, new Map());
      }

      // Create period key from dates
      const periodKey = createPeriodKey(file.periodStartDate, file.periodEndDate);
      const supplierFiles = fileMap.get(supplierId)!;

      // Keep the best file for each period (approved > pending > other)
        const existing = supplierFiles.get(periodKey);
        const isApproved = file.processingStatus === "approved" || file.processingStatus === "auto_approved";
        const isPending = ["needs_review", "pending", "processing"].includes(file.processingStatus);

      if (!existing) {
        supplierFiles.set(periodKey, {
          id: file.id,
          fileName: file.originalFileName,
          status: file.processingStatus,
        });
      } else {
        const existingIsApproved = existing.status === "approved" || existing.status === "auto_approved";
        const existingIsPending = ["needs_review", "pending", "processing"].includes(existing.status);

        // Prefer approved over pending over other
        if (isApproved && !existingIsApproved) {
          supplierFiles.set(periodKey, {
            id: file.id,
            fileName: file.originalFileName,
            status: file.processingStatus,
          });
        } else if (isPending && !existingIsApproved && !existingIsPending) {
          supplierFiles.set(periodKey, {
            id: file.id,
            fileName: file.originalFileName,
            status: file.processingStatus,
          });
        }
      }
    }

    // Current date for filtering future periods
    const now = new Date();

    // Build completeness data for each supplier
    const supplierCompleteness: SupplierCompleteness[] = filteredSuppliers.map(supplier => {
      const rawFrequency = supplier.settlementFrequency || "quarterly";
      // Map unsupported frequencies to quarterly
      const supportedFrequencies: SettlementPeriodType[] = ["monthly", "quarterly", "semi_annual", "annual"];
      const frequency: SettlementPeriodType = supportedFrequencies.includes(rawFrequency as SettlementPeriodType)
        ? (rawFrequency as SettlementPeriodType)
        : "quarterly";
      const fiscalYearStartMonth = supplier.fiscalYearStartMonth ?? 1;
      const periods = getPeriodsForYear(frequency, year, fiscalYearStartMonth);
      const supplierFiles = fileMap.get(supplier.id) || new Map();

      // Filter to only include periods that have ended
      const applicablePeriods = periods.filter(p => p.endDate < now);

      const periodStatuses: PeriodStatus[] = applicablePeriods.map(period => {
        const periodKey = createPeriodKeyFromInfo(period);
        const file = supplierFiles.get(periodKey);

        let status: "approved" | "pending" | "missing" = "missing";
        if (file) {
          if (file.status === "approved" || file.status === "auto_approved") {
            status = "approved";
          } else if (file.status === "needs_review") {
            status = "pending";
          }
        }

        return {
          key: period.key,
          name: period.name,
          nameHe: period.nameHe,
          startDate: formatDateAsLocal(period.startDate),
          endDate: formatDateAsLocal(period.endDate),
          status,
          fileId: file?.id,
          fileName: file?.fileName,
          fileStatus: file?.status,
        };
      });

      const stats = {
        total: periodStatuses.length,
        approved: periodStatuses.filter(p => p.status === "approved").length,
        pending: periodStatuses.filter(p => p.status === "pending").length,
        missing: periodStatuses.filter(p => p.status === "missing").length,
      };

      return {
        supplier: {
          id: supplier.id,
          name: supplier.name,
          code: supplier.code,
        },
        frequency,
        brands: supplier.brands.map(b => ({ id: b.id, nameHe: b.nameHe })),
        periods: periodStatuses,
        stats,
      };
    });

    // Sort by completeness (most missing first)
    supplierCompleteness.sort((a, b) => {
      // First by missing count (descending)
      if (a.stats.missing !== b.stats.missing) {
        return b.stats.missing - a.stats.missing;
      }
      // Then by name
      return a.supplier.name.localeCompare(b.supplier.name, 'he');
    });

    // Get suppliers without parser (no fileMapping AND no custom parser)
    let suppliersWithoutParser = allSuppliers
      .filter(s => !hasParser(s));

    // Apply brand filter if specified
    if (brandId) {
      suppliersWithoutParser = suppliersWithoutParser.filter(s =>
        s.brands.some(b => b.id === brandId)
      );
    }

    // Map to response format and sort by name
    const suppliersWithoutParserResponse: SupplierWithoutParser[] = suppliersWithoutParser
      .map(s => ({
        id: s.id,
        name: s.name,
        code: s.code,
        brands: s.brands.map(b => ({ id: b.id, nameHe: b.nameHe })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));

    // Calculate summary
    const summary = {
      totalSuppliers: supplierCompleteness.length,
      totalExpectedFiles: supplierCompleteness.reduce((sum, s) => sum + s.stats.total, 0),
      received: supplierCompleteness.reduce((sum, s) => sum + s.stats.approved + s.stats.pending, 0),
      approved: supplierCompleteness.reduce((sum, s) => sum + s.stats.approved, 0),
      pending: supplierCompleteness.reduce((sum, s) => sum + s.stats.pending, 0),
      missing: supplierCompleteness.reduce((sum, s) => sum + s.stats.missing, 0),
      completionPercentage: 0,
    };

    summary.completionPercentage = summary.totalExpectedFiles > 0
      ? Math.round((summary.received / summary.totalExpectedFiles) * 100)
      : 0;

    const response: SupplierCompletenessResponse = {
      year,
      suppliers: supplierCompleteness,
      suppliersWithoutParser: suppliersWithoutParserResponse,
      summary,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching supplier completeness:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Create a period key from date strings
 */
function createPeriodKey(startDate: string, endDate: string): string {
  return `${startDate}|${endDate}`;
}

/**
 * Create a period key from SettlementPeriodInfo
 */
function createPeriodKeyFromInfo(period: SettlementPeriodInfo): string {
  return `${formatDateAsLocal(period.startDate)}|${formatDateAsLocal(period.endDate)}`;
}
