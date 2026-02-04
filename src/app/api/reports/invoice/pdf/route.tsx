/* eslint-disable react-hooks/error-boundaries -- This file uses JSX for PDF generation, not React DOM rendering */
import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getCommissionsGroupedByBrand } from "@/data-access/commissions";
import { type CommissionStatus } from "@/db/schema";
import { InvoiceReportPDF } from "@/components/reports/InvoiceReportPDF";

/**
 * GET /api/reports/invoice/pdf - Generate PDF invoice report
 *
 * Query Parameters:
 * - supplierId: (required) Supplier ID
 * - periodStartDate: (required) Period start date (YYYY-MM-DD)
 * - periodEndDate: (required) Period end date (YYYY-MM-DD)
 * - status: (optional) Filter by status (approved is recommended for invoicing)
 *
 * Returns a PDF file with invoice data grouped by brand.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const supplierId = searchParams.get("supplierId");
    const periodStartDate = searchParams.get("periodStartDate");
    const periodEndDate = searchParams.get("periodEndDate");
    const status = searchParams.get("status") as CommissionStatus | null;

    if (!supplierId) {
      return NextResponse.json(
        { error: "supplierId is required" },
        { status: 400 }
      );
    }

    if (!periodStartDate || !periodEndDate) {
      return NextResponse.json(
        { error: "periodStartDate and periodEndDate are required" },
        { status: 400 }
      );
    }

    const invoiceData = await getCommissionsGroupedByBrand(
      supplierId,
      periodStartDate,
      periodEndDate,
      status || undefined
    );

    if (!invoiceData) {
      return NextResponse.json(
        { error: "Supplier not found or no data available" },
        { status: 404 }
      );
    }

    // Render PDF to buffer
    const pdfBuffer = await renderToBuffer(
      <InvoiceReportPDF invoice={invoiceData} />
    );

    // Convert Buffer to Uint8Array for NextResponse compatibility
    const uint8Array = new Uint8Array(pdfBuffer);

    // Generate filename
    const filename = `invoice_${invoiceData.supplierCode}_${periodStartDate}_${periodEndDate}.pdf`;

    // Return PDF file
    return new NextResponse(uint8Array, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error generating invoice PDF:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
