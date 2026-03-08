import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { getClassificationMap } from "@/data-access/franchisee-account-classifications";
import { database } from "@/db";
import { uploadedFile } from "@/db/schema";
import type { BkmvProcessingResult } from "@/db/schema";
import { and, eq, isNotNull, inArray } from "drizzle-orm";

/**
 * POST /api/bkmvdata/recalculate-revenue
 *
 * Recalculates revenue amounts for a franchisee's BKMV files based on
 * current account classifications. This is called when a user overrides
 * an account's classification to/from revenue, ensuring reports reflect
 * the change.
 *
 * Body: { franchiseeId: string }
 * Returns: { updatedFiles: number, skippedFiles: number }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const body = await request.json();
    const { franchiseeId } = body;

    if (!franchiseeId || typeof franchiseeId !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid franchiseeId" },
        { status: 400 }
      );
    }

    // Get current account classifications for this franchisee
    const classificationMap = await getClassificationMap(franchiseeId);

    // Find all BKMV files for this franchisee
    const bkmvFiles = await database
      .select({
        id: uploadedFile.id,
        bkmvProcessingResult: uploadedFile.bkmvProcessingResult,
      })
      .from(uploadedFile)
      .where(
        and(
          eq(uploadedFile.franchiseeId, franchiseeId),
          isNotNull(uploadedFile.bkmvProcessingResult),
          inArray(uploadedFile.processingStatus, [
            "approved",
            "auto_approved",
          ])
        )
      );

    let updatedFiles = 0;
    let skippedFiles = 0;

    for (const file of bkmvFiles) {
      const result = file.bkmvProcessingResult as BkmvProcessingResult;

      // Skip files without revenueAccounts data (legacy files)
      if (!result.revenueAccounts || result.revenueAccounts.length === 0) {
        skippedFiles++;
        continue;
      }

      // Filter revenueAccounts by current classifications:
      // - Keep accounts that are explicitly classified as 'revenue' (saved override)
      // - Keep accounts that have NO saved classification (original auto-detection stands)
      // - Remove accounts that are explicitly classified as something OTHER than 'revenue'
      const filteredRevenueAccounts = result.revenueAccounts.filter(
        (account) => {
          const savedCategory = classificationMap.get(account.accountCode);
          // If no saved classification, keep the original detection
          if (!savedCategory) return true;
          // If explicitly set to revenue, keep
          if (savedCategory === "revenue") return true;
          // If explicitly set to something else, remove from revenue
          return false;
        }
      );

      // Recalculate revenueMonthlyBreakdown from remaining accounts
      const newBreakdown: Record<string, number> = {};
      for (const account of filteredRevenueAccounts) {
        if (account.monthlyBreakdown) {
          for (const [month, amount] of Object.entries(
            account.monthlyBreakdown
          )) {
            newBreakdown[month] = (newBreakdown[month] || 0) + amount;
          }
        } else if (account.totalAmount > 0 && result.dateRange) {
          // Fallback: if no monthly breakdown, distribute evenly across file date range
          const start = new Date(result.dateRange.startDate);
          const end = new Date(result.dateRange.endDate);
          const months: string[] = [];
          const current = new Date(start.getFullYear(), start.getMonth(), 1);
          while (current <= end) {
            const m = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`;
            months.push(m);
            current.setMonth(current.getMonth() + 1);
          }
          if (months.length > 0) {
            const perMonth = account.totalAmount / months.length;
            for (const m of months) {
              newBreakdown[m] = (newBreakdown[m] || 0) + perMonth;
            }
          }
        }
      }

      // Update the stored processing result
      const updatedResult: BkmvProcessingResult = {
        ...result,
        revenueAccounts: filteredRevenueAccounts,
        revenueMonthlyBreakdown: newBreakdown,
        confirmedRevenueAccountCodes: filteredRevenueAccounts.map(
          (a) => a.accountCode
        ),
      };

      await database
        .update(uploadedFile)
        .set({
          bkmvProcessingResult: updatedResult,
        })
        .where(eq(uploadedFile.id, file.id));

      updatedFiles++;
    }

    return NextResponse.json({ updatedFiles, skippedFiles });
  } catch (error) {
    console.error("Revenue recalculation failed:", error);
    return NextResponse.json(
      { error: "Failed to recalculate revenue" },
      { status: 500 }
    );
  }
}
