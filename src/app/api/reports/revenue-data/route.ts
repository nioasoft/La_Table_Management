import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { uploadedFile, franchisee, brand } from "@/db/schema";
import { eq, and, sql, like, isNotNull } from "drizzle-orm";
import type { BkmvProcessingResult } from "@/db/schema";

interface RevenueDataItem {
  franchiseeId: string;
  franchiseeName: string;
  brandName: string;
  month: string;
  amount: number;
  accountCodes: string[];
  fileId: string;
  fileName: string;
  processedAt: string;
}

/**
 * GET /api/reports/revenue-data
 * Get revenue data from uploaded BKMVDATA files
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const franchiseeId = searchParams.get("franchiseeId");
    const year = searchParams.get("year") || new Date().getFullYear().toString();
    const format = searchParams.get("format");

    // Build query conditions
    const conditions = [
      isNotNull(uploadedFile.bkmvProcessingResult),
      isNotNull(uploadedFile.franchiseeId),
    ];

    if (franchiseeId && franchiseeId !== "all") {
      conditions.push(eq(uploadedFile.franchiseeId, franchiseeId));
    }

    // Filter by period year
    if (year) {
      conditions.push(
        sql`${uploadedFile.periodStartDate} LIKE ${`${year}-%`}`
      );
    }

    // Fetch files with processing results
    const files = await database
      .select({
        fileId: uploadedFile.id,
        fileName: uploadedFile.originalFileName,
        franchiseeId: uploadedFile.franchiseeId,
        franchiseeName: franchisee.name,
        brandId: franchisee.brandId,
        brandName: brand.nameHe,
        processingResult: uploadedFile.bkmvProcessingResult,
        createdAt: uploadedFile.createdAt,
      })
      .from(uploadedFile)
      .innerJoin(franchisee, eq(uploadedFile.franchiseeId, franchisee.id))
      .leftJoin(brand, eq(franchisee.brandId, brand.id))
      .where(and(...conditions))
      .orderBy(sql`${uploadedFile.createdAt} DESC`);

    // Extract revenue data from processing results
    const items: RevenueDataItem[] = [];

    for (const file of files) {
      const result = file.processingResult as BkmvProcessingResult | null;
      if (!result) continue;

      // Get revenue monthly breakdown
      const revenueBreakdown = result.revenueMonthlyBreakdown;
      if (!revenueBreakdown || Object.keys(revenueBreakdown).length === 0) {
        continue;
      }

      // Get confirmed account codes
      const accountCodes: string[] = result.confirmedRevenueAccountCodes ||
        (result.confirmedRevenueAccountCode ? [result.confirmedRevenueAccountCode] : []);

      // Create items for each month
      for (const [month, amount] of Object.entries(revenueBreakdown)) {
        // Only include items from the requested year
        if (!month.startsWith(year)) continue;

        items.push({
          franchiseeId: file.franchiseeId!,
          franchiseeName: file.franchiseeName,
          brandName: file.brandName || "לא ידוע",
          month,
          amount: amount as number,
          accountCodes,
          fileId: file.fileId,
          fileName: file.fileName || "BKMVDATA.txt",
          processedAt: result.processedAt,
        });
      }
    }

    // Sort by month (descending) then franchisee name
    items.sort((a, b) => {
      const monthCompare = b.month.localeCompare(a.month);
      if (monthCompare !== 0) return monthCompare;
      return a.franchiseeName.localeCompare(b.franchiseeName, "he");
    });

    // Handle Excel export
    if (format === "xlsx") {
      // For now, return JSON - Excel export can be added later
      return NextResponse.json({
        error: "Excel export not yet implemented",
      }, { status: 501 });
    }

    // Calculate summary
    const summary = {
      totalAmount: items.reduce((sum, item) => sum + item.amount, 0),
      franchiseeCount: new Set(items.map((i) => i.franchiseeId)).size,
      monthCount: new Set(items.map((i) => i.month)).size,
    };

    return NextResponse.json({
      items,
      summary,
    });
  } catch (error) {
    console.error("Error fetching revenue data:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
