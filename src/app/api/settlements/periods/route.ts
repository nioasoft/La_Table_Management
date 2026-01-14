import { NextRequest, NextResponse } from "next/server";
import { requireRole, isAuthError } from "@/lib/api-middleware";
import { getActiveSuppliers } from "@/data-access/suppliers";
import { getFileRequests, type FileRequestWithDetails } from "@/data-access/fileRequests";
import {
  getOpenPeriods,
  getMonthlyPeriods,
  getQuarterlyPeriods,
  getSemiAnnualPeriods,
  getAnnualPeriods,
  type SettlementPeriodInfo,
} from "@/lib/settlement-periods";
import type { SettlementPeriodType } from "@/db/schema";

// Supplier info type
interface SupplierInfo {
  id: string;
  name: string;
  code: string;
  email: string | null;
  contactName: string | null;
}

// Group suppliers by their billing frequency
interface SuppliersByFrequency {
  monthly: SupplierInfo[];
  quarterly: SupplierInfo[];
  semi_annual: SupplierInfo[];
  annual: SupplierInfo[];
}

// Period with its associated suppliers
interface PeriodWithSuppliers {
  period: SettlementPeriodInfo;
  suppliers: SupplierInfo[];
  supplierCount: number;
}

/**
 * GET /api/settlements/periods - Get automatic settlement periods with suppliers
 *
 * Returns periods organized by frequency, each with its associated suppliers.
 * Periods are calculated automatically based on the current date.
 *
 * Query params:
 * - frequency: Filter by specific frequency (monthly, quarterly, semi_annual, annual)
 * - count: Number of historical periods to return per frequency (default: 3)
 * - includeFileRequests: Include file request status for each supplier (default: false)
 * - periodKey: Period key to filter file requests (e.g., "2025-Q4")
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, ["super_user", "admin"]);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const frequency = searchParams.get("frequency") as SettlementPeriodType | null;
    const count = parseInt(searchParams.get("count") || "3", 10);
    const includeFileRequests = searchParams.get("includeFileRequests") === "true";
    const periodKey = searchParams.get("periodKey");

    // Get all active suppliers
    const suppliers = await getActiveSuppliers();

    // Get file requests if requested
    let fileRequests: FileRequestWithDetails[] = [];
    if (includeFileRequests) {
      const allFileRequests = await getFileRequests({
        entityType: "supplier",
        includeExpired: true,
      });
      // Filter by period key if provided (stored in metadata)
      if (periodKey) {
        fileRequests = allFileRequests.filter((fr) => {
          const metadata = fr.metadata as { periodKey?: string } | null;
          return metadata?.periodKey === periodKey;
        });
      } else {
        fileRequests = allFileRequests;
      }
    }

    // Group suppliers by frequency
    const suppliersByFrequency: SuppliersByFrequency = {
      monthly: [],
      quarterly: [],
      semi_annual: [],
      annual: [],
    };

    for (const supplier of suppliers) {
      const freq = supplier.settlementFrequency || "monthly";
      if (suppliersByFrequency[freq as keyof SuppliersByFrequency]) {
        suppliersByFrequency[freq as keyof SuppliersByFrequency].push({
          id: supplier.id,
          name: supplier.name,
          code: supplier.code,
          email: supplier.contactEmail || null,
          contactName: supplier.contactName || null,
        });
      }
    }

    const now = new Date();

    // Build periods response
    const result: Record<string, PeriodWithSuppliers[]> = {};

    if (!frequency || frequency === "monthly") {
      const monthlyPeriods = getMonthlyPeriods(now, count);
      result.monthly = monthlyPeriods.map((period) => ({
        period,
        suppliers: suppliersByFrequency.monthly,
        supplierCount: suppliersByFrequency.monthly.length,
      }));
    }

    if (!frequency || frequency === "quarterly") {
      const quarterlyPeriods = getQuarterlyPeriods(now, count);
      result.quarterly = quarterlyPeriods.map((period) => ({
        period,
        suppliers: suppliersByFrequency.quarterly,
        supplierCount: suppliersByFrequency.quarterly.length,
      }));
    }

    if (!frequency || frequency === "semi_annual") {
      const semiAnnualPeriods = getSemiAnnualPeriods(now, count);
      result.semi_annual = semiAnnualPeriods.map((period) => ({
        period,
        suppliers: suppliersByFrequency.semi_annual,
        supplierCount: suppliersByFrequency.semi_annual.length,
      }));
    }

    if (!frequency || frequency === "annual") {
      const annualPeriods = getAnnualPeriods(now, count);
      result.annual = annualPeriods.map((period) => ({
        period,
        suppliers: suppliersByFrequency.annual,
        supplierCount: suppliersByFrequency.annual.length,
      }));
    }

    // Calculate summary stats
    const summary = {
      totalSuppliers: suppliers.length,
      byFrequency: {
        monthly: suppliersByFrequency.monthly.length,
        quarterly: suppliersByFrequency.quarterly.length,
        semi_annual: suppliersByFrequency.semi_annual.length,
        annual: suppliersByFrequency.annual.length,
      },
      currentDate: now.toISOString(),
    };

    // Format file requests for response
    const formattedFileRequests = fileRequests.map((fr) => ({
      id: fr.id,
      entityId: fr.entityId,
      status: fr.status,
      uploadUrl: fr.uploadUrl,
      sentAt: fr.sentAt,
      submittedAt: fr.submittedAt,
      filesUploaded: fr.filesUploaded,
    }));

    return NextResponse.json({
      periods: result,
      suppliersByFrequency,
      fileRequests: formattedFileRequests,
      summary,
    });
  } catch (error) {
    console.error("Error fetching settlement periods:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
