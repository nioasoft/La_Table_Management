import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { getPeriodByKey } from "@/lib/settlement-periods";
import {
  getCommissionReportData,
  getCommissionsWithDetails,
  type CommissionReportFilters,
} from "@/data-access/commissions";
import { getComparisonsByPeriod, generateReconciliationReport } from "@/data-access/crossReferences";
import { getSettlementPeriodByPeriodKey } from "@/data-access/settlements";
import { getAdjustmentsBySettlementPeriod } from "@/data-access/adjustments";

/**
 * GET /api/settlement-workflow/[periodKey]/reports - Get report data for a period
 *
 * Query params:
 * - format: "json" (default) | "excel"
 * - includeDetails: "true" | "false" (default: false)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ periodKey: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { periodKey } = await params;
    const decodedKey = decodeURIComponent(periodKey);

    const searchParams = request.nextUrl.searchParams;
    const format = searchParams.get("format") || "json";
    const includeDetails = searchParams.get("includeDetails") === "true";

    // Parse period info
    const periodInfo = getPeriodByKey(decodedKey);
    if (!periodInfo) {
      return NextResponse.json(
        { error: "תקופה לא נמצאה", periodKey: decodedKey },
        { status: 404 }
      );
    }

    const periodStartDate = periodInfo.startDate.toISOString().split("T")[0];
    const periodEndDate = periodInfo.endDate.toISOString().split("T")[0];

    // Get settlement period
    const settlementPeriod = await getSettlementPeriodByPeriodKey(decodedKey);

    // Get commission report data
    const filters: CommissionReportFilters = {
      startDate: periodStartDate,
      endDate: periodEndDate,
    };

    const commissionReport = await getCommissionReportData(filters);

    // Get reconciliation data
    const crossReferences = await getComparisonsByPeriod(periodStartDate, periodEndDate);
    const reconciliationReport = await generateReconciliationReport(periodStartDate, periodEndDate);

    // Get adjustments
    const adjustments = settlementPeriod
      ? await getAdjustmentsBySettlementPeriod(settlementPeriod.id)
      : [];

    // Calculate totals
    const totalAdjustmentsAmount = adjustments.reduce(
      (sum, adj) => sum + parseFloat(adj.amount || "0"),
      0
    );

    // Build report response
    const reportData = {
      periodKey: decodedKey,
      periodInfo: {
        nameHe: periodInfo.nameHe,
        name: periodInfo.name,
        type: periodInfo.type,
        startDate: periodStartDate,
        endDate: periodEndDate,
      },
      settlementStatus: settlementPeriod?.status || "not_started",
      approvedAt: settlementPeriod?.approvedAt?.toISOString() || null,
      generatedAt: new Date().toISOString(),
      summary: {
        totalCommissions: commissionReport.summary.totalCommissions,
        totalGrossAmount: commissionReport.summary.totalGrossAmount,
        totalNetAmount: commissionReport.summary.totalNetAmount,
        totalCommissionAmount: commissionReport.summary.totalCommissionAmount,
        avgCommissionRate: commissionReport.summary.avgCommissionRate,
        totalAdjustments: totalAdjustmentsAmount,
        grandTotal: commissionReport.summary.totalCommissionAmount + totalAdjustmentsAmount,
      },
      reconciliation: {
        totalPairs: reconciliationReport?.totalPairs || 0,
        matchedCount: reconciliationReport?.matchedCount || 0,
        discrepancyCount: reconciliationReport?.discrepancyCount || 0,
        pendingCount: reconciliationReport?.pendingCount || 0,
        totalSupplierAmount: reconciliationReport?.totalSupplierAmount || 0,
        totalFranchiseeAmount: reconciliationReport?.totalFranchiseeAmount || 0,
        totalDifference: reconciliationReport?.totalDifference || 0,
      },
      byBrand: commissionReport.byBrand.map((b) => ({
        brandId: b.brandId,
        brandNameHe: b.brandNameHe,
        brandNameEn: b.brandNameEn,
        commissionCount: b.commissionCount,
        totalGrossAmount: b.totalGrossAmount,
        totalNetAmount: b.totalNetAmount,
        totalCommissionAmount: b.totalCommissionAmount,
        avgCommissionRate: b.avgCommissionRate,
      })),
      bySupplier: commissionReport.bySupplier.map((s) => ({
        supplierId: s.supplierId,
        supplierName: s.supplierName,
        supplierCode: s.supplierCode,
        commissionCount: s.commissionCount,
        totalGrossAmount: s.totalGrossAmount,
        totalNetAmount: s.totalNetAmount,
        totalCommissionAmount: s.totalCommissionAmount,
        avgCommissionRate: s.avgCommissionRate,
      })),
      adjustments: adjustments.map((adj) => ({
        id: adj.id,
        type: adj.adjustmentType,
        amount: parseFloat(adj.amount || "0"),
        reason: adj.reason,
        description: adj.description,
        approved: !!adj.approvedAt,
      })),
    };

    // Include details if requested
    if (includeDetails) {
      (reportData as typeof reportData & { details: unknown[] }).details = commissionReport.details.map((d) => ({
        id: d.id,
        supplierName: d.supplierName,
        supplierCode: d.supplierCode,
        franchiseeName: d.franchiseeName,
        franchiseeCode: d.franchiseeCode,
        brandNameHe: d.brandNameHe,
        grossAmount: parseFloat(d.grossAmount || "0"),
        netAmount: d.netAmount ? parseFloat(d.netAmount) : null,
        commissionRate: parseFloat(d.commissionRate || "0"),
        commissionAmount: d.commissionAmount ? parseFloat(d.commissionAmount) : null,
        status: d.status,
      }));
    }

    // Handle Excel export format
    if (format === "excel") {
      // Generate CSV (simplified Excel-compatible format)
      const csvRows: string[] = [];

      // Headers
      csvRows.push([
        "דוח עמלות",
        periodInfo.nameHe,
        `${periodStartDate} - ${periodEndDate}`,
      ].join(","));
      csvRows.push("");

      // Summary section
      csvRows.push("סיכום כללי");
      csvRows.push(`מספר עמלות,${reportData.summary.totalCommissions}`);
      csvRows.push(`סה"כ ברוטו,${reportData.summary.totalGrossAmount.toFixed(2)}`);
      csvRows.push(`סה"כ נטו,${reportData.summary.totalNetAmount.toFixed(2)}`);
      csvRows.push(`סה"כ עמלות,${reportData.summary.totalCommissionAmount.toFixed(2)}`);
      csvRows.push(`התאמות,${reportData.summary.totalAdjustments.toFixed(2)}`);
      csvRows.push(`סה"כ סופי,${reportData.summary.grandTotal.toFixed(2)}`);
      csvRows.push("");

      // By Brand section
      csvRows.push("לפי מותג");
      csvRows.push("מותג,מספר עמלות,ברוטו,נטו,עמלות,אחוז ממוצע");
      for (const brand of reportData.byBrand) {
        csvRows.push([
          brand.brandNameHe,
          brand.commissionCount,
          brand.totalGrossAmount.toFixed(2),
          brand.totalNetAmount.toFixed(2),
          brand.totalCommissionAmount.toFixed(2),
          `${brand.avgCommissionRate.toFixed(2)}%`,
        ].join(","));
      }
      csvRows.push("");

      // By Supplier section
      csvRows.push("לפי ספק");
      csvRows.push("ספק,קוד,מספר עמלות,ברוטו,נטו,עמלות,אחוז ממוצע");
      for (const supplier of reportData.bySupplier) {
        csvRows.push([
          supplier.supplierName,
          supplier.supplierCode,
          supplier.commissionCount,
          supplier.totalGrossAmount.toFixed(2),
          supplier.totalNetAmount.toFixed(2),
          supplier.totalCommissionAmount.toFixed(2),
          `${supplier.avgCommissionRate.toFixed(2)}%`,
        ].join(","));
      }

      // If details included
      if (includeDetails) {
        const detailsData = (reportData as Record<string, unknown>).details as Array<{
          supplierName: string;
          supplierCode: string;
          franchiseeName: string;
          franchiseeCode: string;
          brandNameHe: string;
          grossAmount: number;
          netAmount: number | null;
          commissionRate: number;
          commissionAmount: number | null;
          status: string;
        }> | undefined;

        if (detailsData) {
          csvRows.push("");
          csvRows.push("פירוט");
          csvRows.push("ספק,קוד ספק,זכיין,קוד זכיין,מותג,ברוטו,נטו,אחוז עמלה,עמלה,סטטוס");
          for (const detail of detailsData) {
            csvRows.push([
              detail.supplierName,
              detail.supplierCode,
              detail.franchiseeName,
              detail.franchiseeCode,
              detail.brandNameHe,
              detail.grossAmount.toFixed(2),
              detail.netAmount?.toFixed(2) || "",
              `${detail.commissionRate.toFixed(2)}%`,
              detail.commissionAmount?.toFixed(2) || "",
              detail.status,
            ].join(","));
          }
        }
      }

      const csv = csvRows.join("\n");
      const BOM = "\uFEFF"; // UTF-8 BOM for Excel Hebrew support
      const csvWithBom = BOM + csv;

      return new NextResponse(csvWithBom, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="report-${decodedKey}.csv"`,
        },
      });
    }

    return NextResponse.json(reportData);
  } catch (error) {
    console.error("Error generating report:", error);
    return NextResponse.json(
      { error: "שגיאה בהפקת הדוח" },
      { status: 500 }
    );
  }
}
