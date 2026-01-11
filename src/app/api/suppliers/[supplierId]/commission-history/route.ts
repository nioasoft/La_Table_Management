import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getSupplierById,
  getSupplierCommissionHistory,
} from "@/data-access/suppliers";

interface RouteContext {
  params: Promise<{ supplierId: string }>;
}

/**
 * GET /api/suppliers/[supplierId]/commission-history - Get commission rate change history
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    // Only admins and super users can view commission history
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { supplierId } = await context.params;

    // Check if supplier exists
    const supplier = await getSupplierById(supplierId);
    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    // Fetch commission history
    const history = await getSupplierCommissionHistory(supplierId);

    return NextResponse.json({
      supplierId,
      supplierName: supplier.name,
      currentRate: supplier.defaultCommissionRate,
      history,
    });
  } catch (error) {
    console.error("Error fetching commission history:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
