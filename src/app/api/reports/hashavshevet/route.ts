import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { database } from "@/db";
import {
  supplierFileUpload,
  supplier,
  franchisee,
  brand,
  type SupplierFileProcessingResult,
} from "@/db/schema";
import { eq, and, gte, lte, inArray, isNotNull, or } from "drizzle-orm";

// ============================================================================
// TYPES
// ============================================================================

interface HashavshevetEntry {
  hashavshevetCode: string;
  supplierName: string;
  supplierId: string;
  franchiseeId: string;
  franchiseeName: string;
  brandId: string;
  brandName: string;
  commissionAmount: number;
  periodStartDate: string;
  periodEndDate: string;
  itemKey: string;
}

interface HashavshevetReport {
  summary: {
    totalEntries: number;
    totalCommission: number;
    supplierCount: number;
    franchiseeCount: number;
    generatedAt: string;
  };
  entries: HashavshevetEntry[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate commission for a franchisee match
 */
function calculateMatchCommission(
  match: SupplierFileProcessingResult["franchiseeMatches"][0],
  supplierCommissionRate: string | null,
  supplierCommissionType: string | null
): number {
  // Check for pre-calculated commission first
  if (match.preCalculatedCommission && match.preCalculatedCommission > 0) {
    return Math.trunc(match.preCalculatedCommission * 100) / 100;
  }

  // Calculate based on supplier rate
  if (!supplierCommissionRate) return 0;

  const rate = parseFloat(supplierCommissionRate);
  if (isNaN(rate)) return 0;

  let commission = 0;
  if (supplierCommissionType === "percentage") {
    commission = match.netAmount * (rate / 100);
  } else if (supplierCommissionType === "per_item") {
    // For per-item, count as 1 item per match
    commission = rate;
  }

  return Math.trunc(commission * 100) / 100;
}

// ============================================================================
// API HANDLER
// ============================================================================

/**
 * GET /api/reports/hashavshevet
 * Get data for Hashavshevet export
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const brandIdsParam = searchParams.get("brandIds");
    const supplierIdsParam = searchParams.get("supplierIds");

    // Validate required parameters
    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "חובה לבחור תקופה (תאריך התחלה וסיום)" },
        { status: 400 }
      );
    }

    // Parse arrays
    const brandIds = brandIdsParam ? brandIdsParam.split(",").filter(Boolean) : [];
    const supplierIds = supplierIdsParam ? supplierIdsParam.split(",").filter(Boolean) : [];

    // Build conditions array
     
    const conditions: any[] = [
      // Only approved files
      or(
        eq(supplierFileUpload.processingStatus, "approved"),
        eq(supplierFileUpload.processingStatus, "auto_approved")
      ),
      // Only suppliers with hashavshevet code
      isNotNull(supplier.hashavshevetCode),
      // Period filter
      gte(supplierFileUpload.periodStartDate, startDate),
      lte(supplierFileUpload.periodEndDate, endDate),
    ];

    // Apply supplier filter if specified
    if (supplierIds.length > 0) {
      conditions.push(inArray(supplier.id, supplierIds));
    }

    // Get files with supplier data
    const files = await database
      .select({
        fileId: supplierFileUpload.id,
        supplierId: supplier.id,
        supplierName: supplier.name,
        supplierCode: supplier.code,
        hashavshevetCode: supplier.hashavshevetCode,
        commissionRate: supplier.defaultCommissionRate,
        commissionType: supplier.commissionType,
        processingResult: supplierFileUpload.processingResult,
        periodStartDate: supplierFileUpload.periodStartDate,
        periodEndDate: supplierFileUpload.periodEndDate,
      })
      .from(supplierFileUpload)
      .innerJoin(supplier, eq(supplierFileUpload.supplierId, supplier.id))
      .where(and(...conditions));

    // Get all franchisees and brands for lookups
    const [allFranchisees, allBrands] = await Promise.all([
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
          code: brand.code,
        })
        .from(brand),
    ]);

    // Create lookup maps
    const franchiseeMap = new Map(allFranchisees.map((f) => [f.id, f]));
    const brandMap = new Map(allBrands.map((b) => [b.id, b]));

    // Build entries from processing results
    const entries: HashavshevetEntry[] = [];
    const supplierSet = new Set<string>();
    const franchiseeSet = new Set<string>();

    for (const file of files) {
      if (!file.processingResult || !file.hashavshevetCode) continue;

      const processingResult = file.processingResult as SupplierFileProcessingResult;
      if (!processingResult.franchiseeMatches) continue;

      for (const match of processingResult.franchiseeMatches) {
        // Skip unmatched or blacklisted entries
        if (!match.matchedFranchiseeId || match.matchType === "blacklisted" || match.matchType === "none") {
          continue;
        }

        // Get franchisee info
        const franchiseeInfo = franchiseeMap.get(match.matchedFranchiseeId);
        if (!franchiseeInfo) continue;

        // Filter by brand if specified
        if (brandIds.length > 0 && !brandIds.includes(franchiseeInfo.brandId)) {
          continue;
        }

        // Get brand info
        const brandInfo = brandMap.get(franchiseeInfo.brandId);
        if (!brandInfo) continue;

        // Calculate commission
        const commissionAmount = calculateMatchCommission(
          match,
          file.commissionRate,
          file.commissionType
        );

        // Skip zero commissions
        if (commissionAmount === 0) continue;

        entries.push({
          hashavshevetCode: file.hashavshevetCode,
          supplierName: file.supplierName,
          supplierId: file.supplierId,
          franchiseeId: match.matchedFranchiseeId,
          franchiseeName: franchiseeInfo.name,
          brandId: franchiseeInfo.brandId,
          brandName: brandInfo.nameHe,
          commissionAmount,
          periodStartDate: file.periodStartDate || "",
          periodEndDate: file.periodEndDate || "",
          itemKey: franchiseeInfo.hashavshevetItemKey || `עמלות ${franchiseeInfo.name}`,
        });

        supplierSet.add(file.supplierId);
        franchiseeSet.add(match.matchedFranchiseeId);
      }
    }

    // Calculate summary
    const totalCommission = entries.reduce((sum, e) => sum + e.commissionAmount, 0);

    const report: HashavshevetReport = {
      summary: {
        totalEntries: entries.length,
        totalCommission: Math.trunc(totalCommission * 100) / 100,
        supplierCount: supplierSet.size,
        franchiseeCount: franchiseeSet.size,
        generatedAt: new Date().toISOString(),
      },
      entries,
    };

    return NextResponse.json({ report });
  } catch (error) {
    console.error("Error generating hashavshevet report:", error);
    return NextResponse.json(
      { error: "שגיאה ביצירת הדוח" },
      { status: 500 }
    );
  }
}
