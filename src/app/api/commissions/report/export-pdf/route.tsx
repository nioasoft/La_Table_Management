import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  getCommissionReportData,
  type CommissionReportFilters,
} from "@/data-access/commissions";
import {
  CommissionReportPDF,
  type CommissionReportData,
} from "@/components/reports/CommissionReportPDF";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * GET /api/commissions/report/export-pdf - Export commission report to PDF
 *
 * Query Parameters:
 * - startDate: ISO date string for period start (optional)
 * - endDate: ISO date string for period end (optional)
 * - supplierId: Filter by specific supplier (optional)
 * - brandId: Filter by specific brand (optional)
 * - status: Filter by commission status (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    // Only admins and super users can export commission reports
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const filters: CommissionReportFilters = {
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      supplierId: searchParams.get("supplierId") || undefined,
      brandId: searchParams.get("brandId") || undefined,
      status: searchParams.get("status") || undefined,
    };

    // Fetch report data
    const reportData = await getCommissionReportData(filters);

    // Transform to PDF component format
    const pdfReportData: CommissionReportData = {
      summary: {
        ...reportData.summary,
        generatedAt: reportData.summary.generatedAt,
      },
      byBrand: reportData.byBrand,
      byPeriod: reportData.byPeriod,
      bySupplier: reportData.bySupplier,
      details: reportData.details,
    };

    // Render PDF to buffer
    const pdfBuffer = await renderToBuffer(
      <CommissionReportPDF report={pdfReportData} />
    );

    // Convert Buffer to Uint8Array for NextResponse compatibility
    const uint8Array = new Uint8Array(pdfBuffer);

    // Generate filename with current date
    const today = formatDateAsLocal(new Date());
    const filename = `commission_report_${today}.pdf`;

    // Return PDF file
    return new NextResponse(uint8Array, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error exporting commission report to PDF:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
