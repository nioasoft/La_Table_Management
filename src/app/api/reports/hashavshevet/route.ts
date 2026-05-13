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
  reconciliationComparison,
  type SupplierFileProcessingResult,
} from "@/db/schema";
import { eq, and, gte, lte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { hasCommissionFromFile } from "@/lib/custom-parsers/suppliers-with-file-commission";

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
    // For per-item, count as 1 item per match
    commission = rate;
  }

  return Math.round(commission);
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
    // Default ON: only export (supplier × franchisee) rows whose latest
    // non-archived reconciliation-v2 comparison is approved. Pass
    // ?onlyApproved=false to bypass and include everything that has an
    // approved supplier file (legacy behavior).
    const onlyApproved = searchParams.get("onlyApproved") !== "false";

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
      // Period filter — overlap semantics so annual files appear in sub-period exports.
      // file.start <= requested.end AND file.end >= requested.start
      lte(supplierFileUpload.periodStartDate, endDate),
      gte(supplierFileUpload.periodEndDate, startDate),
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

    // Build approvedSet — keys are "supplierId|franchiseeId|periodStart|periodEnd"
    // pulled from the freshest non-archived reconciliation session per
    // (supplier, period). Empty when the flag is off.
    const approvedSet = new Set<string>();
    if (onlyApproved) {
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

      if (sessionContext.size > 0) {
        const approvedRows = await database
          .select({
            sessionId: reconciliationComparison.sessionId,
            franchiseeId: reconciliationComparison.franchiseeId,
          })
          .from(reconciliationComparison)
          .where(
            and(
              inArray(reconciliationComparison.sessionId, [
                ...sessionContext.keys(),
              ]),
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
      }
    }

    // Build entries from processing results.
    //
    // Aggregation: some parsers (e.g. שרי שוקו) emit one row per invoice rather
    // than one row per franchisee — the per-invoice granularity is needed by
    // reconciliation-v2, but for the Hashavshevet export Reut wants a single
    // line per (supplier × franchisee × period). We aggregate here, NOT in the
    // parser, so reconciliation keeps its detail.
    //
    // Key intentionally includes periodStart/End: if the same supplier has
    // both a monthly and an overlapping quarterly file, those stay as
    // separate Hashavshevet rows (different bookkeeping periods).
    const aggregated = new Map<string, HashavshevetEntry>();
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
          file.commissionType,
          file.supplierCode
        );

        // Skip zero commissions
        if (commissionAmount === 0) continue;

        // Reconciliation gate: drop rows whose latest comparison wasn't approved
        // (or has no session at all). Bypassed when the user unchecks the box.
        if (onlyApproved) {
          const key = `${file.supplierId}|${match.matchedFranchiseeId}|${file.periodStartDate}|${file.periodEndDate}`;
          if (!approvedSet.has(key)) continue;
        }

        const aggKey = `${file.supplierId}|${match.matchedFranchiseeId}|${file.periodStartDate}|${file.periodEndDate}`;
        const existing = aggregated.get(aggKey);
        if (existing) {
          existing.commissionAmount += commissionAmount;
        } else {
          aggregated.set(aggKey, {
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
        }

        supplierSet.add(file.supplierId);
        franchiseeSet.add(match.matchedFranchiseeId);
      }
    }

    const entries: HashavshevetEntry[] = Array.from(aggregated.values());

    // Calculate summary
    const totalCommission = entries.reduce((sum, e) => sum + e.commissionAmount, 0);

    const report: HashavshevetReport = {
      summary: {
        totalEntries: entries.length,
        totalCommission: Math.round(totalCommission),
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
