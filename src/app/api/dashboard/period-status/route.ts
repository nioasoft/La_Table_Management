import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { database } from "@/db";
import {
  settlementPeriod,
  commission,
  crossReference,
  fileRequest,
  franchisee,
  supplier,
} from "@/db/schema";
import { eq, and, gte, lte, sql, desc, or, inArray } from "drizzle-orm";
import type { CrossReferenceComparisonMetadata } from "@/data-access/crossReferences";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * Response type for period status dashboard widget
 */
export type PeriodStatusResponse = {
  currentPeriod: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: string;
    daysRemaining: number;
    daysElapsed: number;
    totalDays: number;
    progressPercentage: number;
  } | null;
  reportStatus: {
    suppliersTotal: number;
    suppliersReceived: number;
    suppliersMissing: number;
    franchiseesTotal: number;
    franchiseesReceived: number;
    franchiseesMissing: number;
    overallPercentage: number;
  };
  crossReferenceStatus: {
    total: number;
    matched: number;
    discrepancies: number;
    pending: number;
    matchedPercentage: number;
  };
  pendingActions: {
    total: number;
    items: Array<{
      type: "discrepancy" | "approval" | "missing_report" | "expiring_link";
      count: number;
      priority: "high" | "medium" | "low";
      description: string;
    }>;
  };
  workflowProgress: {
    currentStep: string;
    steps: Array<{
      name: string;
      status: "completed" | "current" | "pending";
      count: number;
    }>;
  };
};

/**
 * GET /api/dashboard/period-status
 * Returns comprehensive period status for the dashboard widget
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Calculate current period dates (current month)
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const currentMonthStartStr = formatDateAsLocal(currentMonthStart);
    const currentMonthEndStr = formatDateAsLocal(currentMonthEnd);

    // Fetch all data in parallel
    const [
      currentPeriodResult,
      allSuppliers,
      allFranchisees,
      fileRequests,
      crossReferences,
      settlementStats,
      commissionsWithUploads,
    ] = await Promise.all([
      // Get current/most recent open settlement period
      database
        .select()
        .from(settlementPeriod)
        .where(
          or(
            eq(settlementPeriod.status, "open"),
            eq(settlementPeriod.status, "processing")
          )
        )
        .orderBy(desc(settlementPeriod.periodStartDate))
        .limit(1),

      // Get all active suppliers (suppliers use isActive boolean, not status enum)
      database
        .select({ id: supplier.id, name: supplier.name })
        .from(supplier)
        .where(eq(supplier.isActive, true)),

      // Get all active franchisees
      database
        .select({ id: franchisee.id, name: franchisee.name })
        .from(franchisee)
        .where(eq(franchisee.status, "active")),

      // Get file requests for current period
      database
        .select()
        .from(fileRequest)
        .where(
          and(
            or(
              eq(fileRequest.status, "pending"),
              eq(fileRequest.status, "sent"),
              eq(fileRequest.status, "submitted")
            ),
            gte(fileRequest.createdAt, currentMonthStart)
          )
        ),

      // Get cross-references for amount comparison
      database
        .select()
        .from(crossReference)
        .where(
          and(
            eq(crossReference.referenceType, "amount_comparison"),
            eq(crossReference.isActive, true)
          )
        ),

      // Get settlement workflow counts by status
      database
        .select({
          status: settlementPeriod.status,
          count: sql<number>`count(*)::int`,
        })
        .from(settlementPeriod)
        .groupBy(settlementPeriod.status),

      // Get commissions for current period (indicates reports received)
      database
        .select({
          supplierId: commission.supplierId,
          franchiseeId: commission.franchiseeId,
        })
        .from(commission)
        .where(
          and(
            gte(commission.periodStartDate, currentMonthStartStr),
            lte(commission.periodEndDate, currentMonthEndStr)
          )
        ),
    ]);

    // Process current period
    let currentPeriod: PeriodStatusResponse["currentPeriod"] = null;
    if (currentPeriodResult.length > 0) {
      const period = currentPeriodResult[0];
      const startDate = new Date(period.periodStartDate);
      const endDate = new Date(period.periodEndDate);
      const totalDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const daysElapsed = Math.max(
        0,
        Math.ceil(
          (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
        )
      );
      const daysRemaining = Math.max(
        0,
        Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      );
      const progressPercentage = Math.min(
        100,
        Math.round((daysElapsed / totalDays) * 100)
      );

      currentPeriod = {
        id: period.id,
        name: period.name,
        startDate: period.periodStartDate,
        endDate: period.periodEndDate,
        status: period.status,
        daysRemaining,
        daysElapsed,
        totalDays,
        progressPercentage,
      };
    }

    // Calculate report status
    const suppliersTotal = allSuppliers.length;
    const franchiseesTotal = allFranchisees.length;

    // Find suppliers/franchisees who have submitted reports (commissions exist)
    const suppliersWithReports = new Set(
      commissionsWithUploads.map((c) => c.supplierId)
    );
    const franchiseesWithReports = new Set(
      commissionsWithUploads.map((c) => c.franchiseeId)
    );

    const suppliersReceived = suppliersWithReports.size;
    const franchiseesReceived = franchiseesWithReports.size;
    const suppliersMissing = Math.max(0, suppliersTotal - suppliersReceived);
    const franchiseesMissing = Math.max(
      0,
      franchiseesTotal - franchiseesReceived
    );

    const totalReports = suppliersTotal + franchiseesTotal;
    const receivedReports = suppliersReceived + franchiseesReceived;
    const overallPercentage =
      totalReports > 0 ? Math.round((receivedReports / totalReports) * 100) : 0;

    const reportStatus: PeriodStatusResponse["reportStatus"] = {
      suppliersTotal,
      suppliersReceived,
      suppliersMissing,
      franchiseesTotal,
      franchiseesReceived,
      franchiseesMissing,
      overallPercentage,
    };

    // Process cross-reference status
    // Filter cross-references for current period
    const currentPeriodCrossRefs = crossReferences.filter((cr) => {
      const metadata = cr.metadata as CrossReferenceComparisonMetadata;
      return (
        metadata?.periodStartDate === currentMonthStartStr &&
        metadata?.periodEndDate === currentMonthEndStr
      );
    });

    let matched = 0;
    let discrepancies = 0;
    let pending = 0;

    for (const cr of currentPeriodCrossRefs) {
      const metadata = cr.metadata as CrossReferenceComparisonMetadata;
      const status = metadata?.matchStatus || "pending";
      if (status === "matched") {
        matched++;
      } else if (status === "discrepancy") {
        discrepancies++;
      } else {
        pending++;
      }
    }

    const totalCrossRefs = currentPeriodCrossRefs.length;
    const matchedPercentage =
      totalCrossRefs > 0 ? Math.round((matched / totalCrossRefs) * 100) : 0;

    const crossReferenceStatus: PeriodStatusResponse["crossReferenceStatus"] = {
      total: totalCrossRefs,
      matched,
      discrepancies,
      pending,
      matchedPercentage,
    };

    // Calculate pending actions
    const pendingActionItems: PeriodStatusResponse["pendingActions"]["items"] =
      [];

    // Discrepancies (high priority)
    if (discrepancies > 0) {
      pendingActionItems.push({
        type: "discrepancy",
        count: discrepancies,
        priority: "high",
        description: `${discrepancies} discrepancies require review`,
      });
    }

    // Pending approvals (high priority)
    const pendingApprovalCount =
      settlementStats.find((s) => s.status === "pending_approval")?.count || 0;
    if (pendingApprovalCount > 0) {
      pendingActionItems.push({
        type: "approval",
        count: pendingApprovalCount,
        priority: "high",
        description: `${pendingApprovalCount} settlements awaiting approval`,
      });
    }

    // Missing reports (medium priority)
    const missingReportsCount = suppliersMissing + franchiseesMissing;
    if (missingReportsCount > 0) {
      pendingActionItems.push({
        type: "missing_report",
        count: missingReportsCount,
        priority: "medium",
        description: `${missingReportsCount} reports not yet received`,
      });
    }

    // Expiring upload links (low priority)
    const expiringLinks = fileRequests.filter((fr) => {
      if (!fr.dueDate) return false;
      const dueDate = new Date(fr.dueDate);
      const daysUntilDue = Math.ceil(
        (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      return daysUntilDue <= 3 && daysUntilDue > 0;
    }).length;

    if (expiringLinks > 0) {
      pendingActionItems.push({
        type: "expiring_link",
        count: expiringLinks,
        priority: "low",
        description: `${expiringLinks} upload links expiring soon`,
      });
    }

    const pendingActions: PeriodStatusResponse["pendingActions"] = {
      total: pendingActionItems.reduce((sum, item) => sum + item.count, 0),
      items: pendingActionItems.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }),
    };

    // Calculate workflow progress
    const workflowSteps: PeriodStatusResponse["workflowProgress"]["steps"] = [];
    let currentStep = "open";

    // Map settlement stats to workflow steps
    const openCount =
      (settlementStats.find((s) => s.status === "open")?.count || 0) +
      (settlementStats.find((s) => s.status === "draft")?.count || 0);
    const processingCount =
      (settlementStats.find((s) => s.status === "processing")?.count || 0) +
      (settlementStats.find((s) => s.status === "pending")?.count || 0);
    const pendingApproval = pendingApprovalCount;
    const approvedCount =
      settlementStats.find((s) => s.status === "approved")?.count || 0;
    const invoicedCount =
      (settlementStats.find((s) => s.status === "invoiced")?.count || 0) +
      (settlementStats.find((s) => s.status === "completed")?.count || 0);

    // Determine current step based on where most activity is
    if (pendingApproval > 0) {
      currentStep = "pending_approval";
    } else if (processingCount > 0) {
      currentStep = "processing";
    } else if (approvedCount > 0 && invoicedCount === 0) {
      currentStep = "approved";
    } else if (invoicedCount > 0) {
      currentStep = "invoiced";
    }

    workflowSteps.push({
      name: "open",
      status:
        currentStep === "open"
          ? "current"
          : openCount > 0 ||
              processingCount > 0 ||
              pendingApproval > 0 ||
              approvedCount > 0
            ? "completed"
            : "pending",
      count: openCount,
    });

    workflowSteps.push({
      name: "processing",
      status:
        currentStep === "processing"
          ? "current"
          : processingCount > 0 || pendingApproval > 0 || approvedCount > 0
            ? "completed"
            : "pending",
      count: processingCount,
    });

    workflowSteps.push({
      name: "pending_approval",
      status:
        currentStep === "pending_approval"
          ? "current"
          : approvedCount > 0 || invoicedCount > 0
            ? "completed"
            : "pending",
      count: pendingApproval,
    });

    workflowSteps.push({
      name: "approved",
      status:
        currentStep === "approved"
          ? "current"
          : invoicedCount > 0
            ? "completed"
            : "pending",
      count: approvedCount,
    });

    workflowSteps.push({
      name: "invoiced",
      status: currentStep === "invoiced" ? "current" : "pending",
      count: invoicedCount,
    });

    const workflowProgress: PeriodStatusResponse["workflowProgress"] = {
      currentStep,
      steps: workflowSteps,
    };

    const response: PeriodStatusResponse = {
      currentPeriod,
      reportStatus,
      crossReferenceStatus,
      pendingActions,
      workflowProgress,
    };

    return NextResponse.json({ data: response });
  } catch (error) {
    console.error("Error fetching period status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
