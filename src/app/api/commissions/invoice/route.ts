import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getCommissionsGroupedByBrand } from "@/data-access/commissions";
import { type CommissionStatus } from "@/db/schema";
import { getActiveSuppliers } from "@/data-access/suppliers";

/**
 * GET /api/commissions/invoice - Get commissions grouped by brand for invoicing
 *
 * Query Parameters:
 * - supplierId: (required) Supplier ID
 * - periodStartDate: (required) Period start date (YYYY-MM-DD)
 * - periodEndDate: (required) Period end date (YYYY-MM-DD)
 * - status: (optional) Filter by status (approved is recommended for invoicing)
 *
 * Returns commissions grouped by brand with summaries, ready for invoice generation.
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
        { error: "Supplier not found" },
        { status: 404 }
      );
    }

    // Get list of suppliers for filter dropdown
    const suppliers = await getActiveSuppliers();

    return NextResponse.json({
      invoiceData,
      filters: {
        suppliers: suppliers.map((s) => ({
          id: s.id,
          name: s.name,
          code: s.code,
        })),
        statuses: ["pending", "calculated", "approved", "paid", "cancelled"],
      },
    });
  } catch (error) {
    console.error("Error fetching invoice data:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
